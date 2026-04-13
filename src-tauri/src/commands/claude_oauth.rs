use std::path::PathBuf;
use serde::{Deserialize, Serialize};

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

// ── Path resolution ────────────────────────────────────────────────────────

fn claude_credentials_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".claude").join(".credentials.json")
}

// ── Credential reading ─────────────────────────────────────────────────────

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

// ── Token expiry check ─────────────────────────────────────────────────────

fn is_expiring_soon(expires_at_ms: u64) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    // Refresh if within 5 minutes of expiry
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
        return Err(format!("OAuth refresh returned {status}: {body}"));
    }

    response
        .json::<OAuthRefreshResponse>()
        .await
        .map_err(|e| format!("Cannot parse OAuth refresh response: {e}"))
}

// ── Public API ─────────────────────────────────────────────────────────────

/// Returns the current access token, refreshing proactively if within 5 minutes
/// of expiry. Writes the updated token back to `~/.claude/.credentials.json`.
pub async fn get_claude_oauth_token() -> Result<String, String> {
    let path = claude_credentials_path();
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| "~/.claude/.credentials.json not found. Sign in with the Claude CLI first.".to_string())?;

    let mut file: ClaudeCredentialsFile = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse .credentials.json: {e}"))?;

    let oauth = file
        .claude_ai_oauth
        .as_mut()
        .filter(|o| !o.access_token.is_empty())
        .ok_or_else(|| "No OAuth credentials found in .credentials.json".to_string())?;

    if !is_expiring_soon(oauth.expires_at) {
        return Ok(oauth.access_token.clone());
    }

    eprintln!("[ClaudeOAuth] Token expiring soon, refreshing...");
    let refreshed = do_oauth_refresh(&oauth.refresh_token).await?;

    oauth.access_token = refreshed.access_token.clone();
    if let Some(new_rt) = refreshed.refresh_token {
        oauth.refresh_token = new_rt;
    }
    // expires_in is seconds; convert to unix ms
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    oauth.expires_at = now_ms + refreshed.expires_in * 1000;

    let updated = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Cannot serialize credentials: {e}"))?;
    tokio::fs::write(&path, updated)
        .await
        .map_err(|e| format!("Cannot write .credentials.json: {e}"))?;

    eprintln!("[ClaudeOAuth] Token refreshed and written.");
    Ok(refreshed.access_token)
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Returns true if `~/.claude/.credentials.json` exists and contains a non-empty OAuth token.
#[tauri::command]
pub async fn check_claude_oauth() -> Result<bool, String> {
    Ok(read_oauth_from_file().is_some())
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
