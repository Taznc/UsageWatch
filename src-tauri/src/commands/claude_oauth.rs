use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

/// After a hard refresh failure back off for this long before retrying,
/// provided the refresh token has not changed (i.e. user has not re-authenticated).
const REFRESH_BACKOFF: Duration = Duration::from_secs(30 * 60); // 30 minutes

/// Tracks the last failed refresh: (when it failed, which refresh_token failed).
/// If the token in the credentials file has since changed (user re-logged in),
/// the backoff is bypassed automatically.
static REFRESH_FAILURE: Mutex<Option<(Instant, String)>> = Mutex::new(None);

const CLAUDE_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_SCOPE: &str =
    "user:profile user:inference user:sessions:claude_code user:mcp_servers";

// ── Credential file structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAiOauth {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    /// Unix milliseconds
    #[serde(default)]
    pub expires_at: u64,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub subscription_type: Option<String>,
}

/// Top-level structure for both keychain JSON and file-based credentials.
/// Claude Code uses camelCase (`claudeAiOauth`), so `rename_all = "camelCase"` applies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCredentialsFile {
    pub claude_ai_oauth: Option<ClaudeAiOauth>,
}

#[derive(Debug, Deserialize)]
struct OAuthRefreshResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Seconds until expiry
    #[serde(default)]
    pub expires_in: u64,
}

// ── Path resolution (file fallback) ───────────────────────────────────────

fn claude_credentials_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".claude").join(".credentials.json")
}

// ── macOS Keychain access ──────────────────────────────────────────────────

/// Read Claude Code credentials from the macOS Keychain.
/// Claude Code (v2+) stores OAuth tokens as JSON under service "Claude Code-credentials".
#[cfg(target_os = "macos")]
fn read_oauth_from_keychain() -> Option<ClaudeAiOauth> {
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = std::str::from_utf8(&output.stdout).ok()?.trim();
    let parsed: ClaudeCredentialsFile = serde_json::from_str(json_str).ok()?;
    let oauth = parsed.claude_ai_oauth?;
    if oauth.access_token.is_empty() {
        return None;
    }
    Some(oauth)
}

/// Write updated credentials back to the macOS Keychain after a token refresh.
#[cfg(target_os = "macos")]
fn write_oauth_to_keychain(oauth: &ClaudeAiOauth) -> Result<(), String> {
    let file = ClaudeCredentialsFile { claude_ai_oauth: Some(oauth.clone()) };
    let json = serde_json::to_string(&file)
        .map_err(|e| format!("Cannot serialize credentials: {e}"))?;

    let account = std::env::var("USER").unwrap_or_else(|_| "claude".to_string());

    // Delete existing entry first (add fails if it already exists)
    let _ = std::process::Command::new("security")
        .args(["delete-generic-password", "-s", "Claude Code-credentials"])
        .output();

    let status = std::process::Command::new("security")
        .args(["add-generic-password", "-s", "Claude Code-credentials", "-a", &account, "-w", &json])
        .status()
        .map_err(|e| format!("security command failed: {e}"))?;

    if !status.success() {
        return Err("Failed to write updated credentials to keychain".to_string());
    }
    Ok(())
}

// ── Credential reading (platform-aware) ───────────────────────────────────

fn read_oauth_from_file() -> Option<ClaudeAiOauth> {
    let path = claude_credentials_path();
    let content = std::fs::read_to_string(&path).ok()?;
    let parsed: ClaudeCredentialsFile = serde_json::from_str(&content).ok()?;
    let oauth = parsed.claude_ai_oauth?;
    if oauth.access_token.is_empty() {
        return None;
    }
    Some(oauth)
}

/// Try keychain first on macOS, then fall back to file.
fn read_oauth() -> Option<ClaudeAiOauth> {
    #[cfg(target_os = "macos")]
    {
        if let Some(oauth) = read_oauth_from_keychain() {
            return Some(oauth);
        }
    }
    read_oauth_from_file()
}

// ── Token expiry check ─────────────────────────────────────────────────────

fn is_expiring_soon(expires_at_ms: u64) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let five_min_ms: u64 = 5 * 60 * 1000;
    expires_at_ms <= now_ms.saturating_add(five_min_ms)
}

// ── Token refresh ──────────────────────────────────────────────────────────

async fn do_oauth_refresh(refresh_token: &str) -> Result<OAuthRefreshResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(CLAUDE_OAUTH_TOKEN_URL)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLAUDE_OAUTH_CLIENT_ID,
            "scope": CLAUDE_OAUTH_SCOPE,
        }))
        .send()
        .await
        .map_err(|e| format!("OAuth refresh request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        // Detect invalid/expired refresh token and surface a clear action message.
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
            if val.get("error").and_then(|v| v.as_str()) == Some("invalid_grant") {
                return Err(
                    "Claude Code session expired — run 'claude' in your terminal to log in again."
                        .to_string(),
                );
            }
        }

        return Err(format!("OAuth refresh returned {status}: {body}"));
    }

    response
        .json::<OAuthRefreshResponse>()
        .await
        .map_err(|e| format!("Cannot parse OAuth refresh response: {e}"))
}

// ── Public API ─────────────────────────────────────────────────────────────

/// Returns the current access token, refreshing proactively if within 5 minutes
/// of expiry. Writes the updated token back to keychain (macOS) or file.
pub async fn get_claude_oauth_token() -> Result<String, String> {
    let mut oauth = read_oauth().ok_or_else(|| {
        #[cfg(target_os = "macos")]
        return "Claude Code credentials not found. Sign in with the Claude CLI first (run 'claude' in a terminal).".to_string();
        #[cfg(not(target_os = "macos"))]
        return "~/.claude/.credentials.json not found. Sign in with the Claude CLI first.".to_string();
    })?;

    if !is_expiring_soon(oauth.expires_at) {
        // Token is fresh — clear any stale backoff and use it directly.
        if let Ok(mut g) = REFRESH_FAILURE.lock() {
            *g = None;
        }
        return Ok(oauth.access_token.clone());
    }

    // Token is expiring/expired.  Check if we should back off.
    // Backoff is keyed on the refresh token: if the user re-authenticated, their
    // refresh token changes and the backoff is bypassed immediately.
    if let Ok(g) = REFRESH_FAILURE.lock() {
        if let Some((failed_at, ref failed_rt)) = *g {
            if failed_rt == &oauth.refresh_token && failed_at.elapsed() < REFRESH_BACKOFF {
                return Err(
                    "Claude Code session expired — run 'claude' in your terminal to log in again."
                        .to_string(),
                );
            }
        }
    }

    eprintln!("[ClaudeOAuth] Token expiring soon, refreshing...");
    let refreshed = match do_oauth_refresh(&oauth.refresh_token).await {
        Ok(r) => r,
        Err(e) => {
            // Record the failure against this specific refresh token.
            if let Ok(mut g) = REFRESH_FAILURE.lock() {
                *g = Some((Instant::now(), oauth.refresh_token.clone()));
            }
            return Err(e);
        }
    };
    // Successful refresh — clear the backoff.
    if let Ok(mut g) = REFRESH_FAILURE.lock() {
        *g = None;
    }

    oauth.access_token = refreshed.access_token.clone();
    if let Some(new_rt) = refreshed.refresh_token {
        oauth.refresh_token = new_rt;
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    oauth.expires_at = now_ms + refreshed.expires_in * 1000;

    // Write back — keychain on macOS, file on other platforms
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = write_oauth_to_keychain(&oauth) {
            eprintln!("[ClaudeOAuth] Failed to write keychain: {e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let path = claude_credentials_path();
        let file = ClaudeCredentialsFile { claude_ai_oauth: Some(oauth.clone()) };
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(&path, json);
        }
    }

    eprintln!("[ClaudeOAuth] Token refreshed.");
    Ok(refreshed.access_token)
}

/// Returns true if Claude Code credentials are available (keychain on macOS, file on others).
#[tauri::command]
pub async fn check_claude_oauth() -> Result<bool, String> {
    Ok(read_oauth().is_some())
}

/// Saves the preferred Claude auth method ("session_key" or "oauth") to the store
/// and updates the in-memory cache.
#[tauri::command]
pub fn set_claude_auth_method(
    app: tauri::AppHandle,
    method: String,
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<(), String> {
    super::credentials::save_to_store(&app, "claude_auth_method", &method)?;
    cache.set_claude_auth_method(method);
    Ok(())
}

/// Returns the currently saved Claude auth method from the in-memory cache.
#[tauri::command]
pub fn get_claude_auth_method(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<String, String> {
    Ok(cache.get_claude_auth_method())
}
