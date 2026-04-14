use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::models::{CodexApiResponse, CodexUsageData};

const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

// ── auth.json structures ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthTokens {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthJson {
    #[serde(rename = "OPENAI_API_KEY", default)]
    pub openai_api_key: Option<String>,
    pub tokens: Option<AuthTokens>,
    #[serde(default)]
    pub last_refresh: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    pub access_token: String,
    pub id_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

// ── Path resolution ────────────────────────────────────────────────────────

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn codex_auth_paths() -> Vec<(PathBuf, String)> {
    let mut paths = Vec::new();

    if let Ok(home) = std::env::var("CODEX_HOME") {
        let path = PathBuf::from(home).join("auth.json");
        paths.push((path, "CODEX_HOME/auth.json".to_string()));
    }

    let home_dir = home_dir();
    paths.push((home_dir.join(".config").join("codex").join("auth.json"), "~/.config/codex/auth.json".to_string()));
    paths.push((home_dir.join(".codex").join("auth.json"), "~/.codex/auth.json".to_string()));
    paths
}

#[cfg(target_os = "macos")]
fn read_auth_from_keychain() -> Option<AuthJson> {
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Codex Auth", "-w"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = std::str::from_utf8(&output.stdout).ok()?.trim();
    let parsed: AuthJson = serde_json::from_str(json_str).ok()?;
    parsed.tokens.as_ref()?;
    Some(parsed)
}

#[cfg(target_os = "macos")]
fn write_auth_to_keychain(auth: &AuthJson) -> Result<(), String> {
    let json = serde_json::to_string(auth)
        .map_err(|e| format!("Cannot serialize auth: {e}"))?;
    let account = std::env::var("USER").unwrap_or_else(|_| "codex".to_string());
    let _ = std::process::Command::new("security")
        .args(["delete-generic-password", "-s", "Codex Auth"])
        .output();
    let status = std::process::Command::new("security")
        .args(["add-generic-password", "-s", "Codex Auth", "-a", &account, "-w", &json])
        .status()
        .map_err(|e| format!("security command failed: {e}"))?;
    if !status.success() {
        return Err("Failed to write updated Codex credentials to keychain".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct AuthRecord {
    auth: AuthJson,
    source_label: String,
    path: Option<PathBuf>,
}

fn read_auth_record() -> Option<AuthRecord> {
    for (path, label) in codex_auth_paths() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(auth) = serde_json::from_str::<AuthJson>(&content) {
                if auth.tokens.is_some() {
                    return Some(AuthRecord {
                        auth,
                        source_label: label,
                        path: Some(path),
                    });
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(auth) = read_auth_from_keychain() {
            return Some(AuthRecord {
                auth,
                source_label: "macOS Keychain".to_string(),
                path: None,
            });
        }
    }

    None
}

// ── Token management ───────────────────────────────────────────────────────

async fn do_token_refresh(refresh_token: &str) -> Result<AuthTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(CODEX_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CODEX_CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Token refresh returned status {}", response.status()));
    }

    let resp: RefreshResponse = response
        .json()
        .await
        .map_err(|e| format!("Cannot parse refresh response: {e}"))?;

    Ok(AuthTokens {
        access_token: resp.access_token,
        id_token: resp.id_token,
        refresh_token: resp.refresh_token.unwrap_or_else(|| refresh_token.to_string()),
        account_id: None,
    })
}

/// Fetch Codex usage using a ChatGPT browser session cookie instead of a Bearer token.
/// `cookie` is a full Cookie header value, e.g.:
///   "__Secure-next-auth.session-token=<value>"          (single)
///   "__Secure-next-auth.session-token.0=<v0>; ...1=<v1>" (chunked)
async fn fetch_codex_usage_with_cookie(cookie: &str) -> Result<CodexUsageData, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(CODEX_USAGE_URL)
        .header("Cookie", cookie)
        .header("Content-Type", "application/json")
        .header("User-Agent", "UsageWatch/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Codex request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ChatGPT session cookie expired or invalid. Re-scan your browser.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Codex API returned status {}", response.status()));
    }

    let api_resp: CodexApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Codex usage data: {e}"))?;

    Ok(CodexUsageData::from_api(api_resp, None, Some("Browser session".to_string()), None))
}

async fn persist_auth_record(record: &AuthRecord) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if record.path.is_none() {
        return write_auth_to_keychain(&record.auth);
    }

    if let Some(path) = &record.path {
        if let Some(parent) = path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let updated = serde_json::to_string_pretty(&record.auth)
            .map_err(|e| format!("Cannot serialize auth: {e}"))?;
        tokio::fs::write(path, updated)
            .await
            .map_err(|e| format!("Cannot write auth.json: {e}"))?;
    }

    Ok(())
}

async fn resolve_codex_auth(manual_token: Option<String>) -> Result<(String, Option<AuthRecord>), String> {
    let mut record = match read_auth_record() {
        Some(record) => record,
        None => {
            if let Some(token) = manual_token {
                return Ok((token, None));
            }
            return Err("Codex credentials not found in CODEX_HOME, ~/.config/codex, ~/.codex, or macOS Keychain. Authenticate with the Codex CLI/app or enter a token manually.".to_string());
        }
    };

    let tokens = record
        .auth
        .tokens
        .as_ref()
        .ok_or_else(|| "No tokens found in Codex credentials".to_string())?;

    // Refresh if last_refresh is ≥ 8 days ago (or missing)
    let needs_refresh = record
        .auth
        .last_refresh
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| {
            let age = chrono::Utc::now().signed_duration_since(dt.with_timezone(&chrono::Utc));
            age.num_days() >= 8
        })
        .unwrap_or(true);

    if needs_refresh {
        eprintln!("[Codex] Access token stale, refreshing...");
        let new_tokens = do_token_refresh(&tokens.refresh_token).await?;
        let access_token = new_tokens.access_token.clone();
        let account_id = tokens.account_id.clone();

        record.auth.tokens = Some(AuthTokens {
            account_id,
            ..new_tokens
        });
        record.auth.last_refresh = Some(chrono::Utc::now().to_rfc3339());
        persist_auth_record(&record).await?;

        eprintln!("[Codex] Token refreshed and persisted");
        Ok((access_token, Some(record)))
    } else {
        Ok((tokens.access_token.clone(), Some(record)))
    }
}

// ── Usage fetch ────────────────────────────────────────────────────────────

pub(crate) async fn fetch_codex_usage_internal(manual_token: Option<String>) -> Result<CodexUsageData, String> {
    let (mut token, mut record) = resolve_codex_auth(manual_token).await?;
    let client = reqwest::Client::new();

    loop {
        let mut request = client
            .get(CODEX_USAGE_URL)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("User-Agent", "UsageWatch/0.1.0");

        if let Some(account_id) = record
            .as_ref()
            .and_then(|r| r.auth.tokens.as_ref())
            .and_then(|t| t.account_id.as_ref())
        {
            request = request.header("ChatGPT-Account-Id", account_id);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Codex request failed: {e}"))?;

        if matches!(response.status(), reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN) {
            let Some(mut record_value) = record.take() else {
                return Err("Codex token expired or invalid. Please re-authenticate with the Codex App or CLI.".to_string());
            };
            let refresh_token = record_value
                .auth
                .tokens
                .as_ref()
                .map(|t| t.refresh_token.clone())
                .filter(|t| !t.is_empty())
                .ok_or_else(|| "Codex token expired and no refresh token is available. Please re-authenticate.".to_string())?;
            let new_tokens = do_token_refresh(&refresh_token).await?;
            let account_id = record_value.auth.tokens.as_ref().and_then(|t| t.account_id.clone());
            token = new_tokens.access_token.clone();
            record_value.auth.tokens = Some(AuthTokens { account_id, ..new_tokens });
            record_value.auth.last_refresh = Some(chrono::Utc::now().to_rfc3339());
            persist_auth_record(&record_value).await?;
            record = Some(record_value);
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("Codex API returned status {}", response.status()));
        }

        let api_resp: CodexApiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Codex usage data: {e}"))?;

        let account_id = record
            .as_ref()
            .and_then(|r| r.auth.tokens.as_ref())
            .and_then(|t| t.account_id.clone());
        let auth_source = record.as_ref().map(|r| r.source_label.clone());
        let last_refresh_at = record.as_ref().and_then(|r| r.auth.last_refresh.clone());

        return Ok(CodexUsageData::from_api(
            api_resp,
            account_id,
            auth_source.or_else(|| Some("Manual token".to_string())),
            last_refresh_at,
        ));
    }
}

pub(crate) async fn fetch_codex_usage_with_fallbacks(
    browser_cookie: Option<String>,
    manual_token: Option<String>,
) -> Result<CodexUsageData, String> {
    if let Some(cookie) = browser_cookie {
        return fetch_codex_usage_with_cookie(&cookie).await;
    }

    fetch_codex_usage_internal(manual_token).await
}

// ── Tauri commands ─────────────────────────────────────────────────────────

// ── Manual token support ──────────────────────────────────────────────────

const CODEX_MANUAL_TOKEN_KEY: &str = "codex_manual_token";

/// Validate a manually-provided token by hitting the Codex usage endpoint.
#[tauri::command]
pub async fn test_codex_connection(token: String) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(CODEX_USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "UsageWatch/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Codex request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Token is invalid or expired.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Codex API returned status {}", response.status()));
    }
    Ok(true)
}

/// Save a manually-entered Codex access token to the credential store.
#[tauri::command]
pub fn save_codex_token(
    app: tauri::AppHandle,
    token: String,
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<(), String> {
    super::credentials::save_to_store(&app, CODEX_MANUAL_TOKEN_KEY, &token)?;
    cache.set_codex_manual_token(token);
    Ok(())
}

/// Read the manually-saved Codex token from the credential store.
#[tauri::command]
pub fn get_codex_token(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<Option<String>, String> {
    Ok(cache.get_codex_manual_token())
}

/// Returns true if ~/.codex/auth.json exists and contains tokens.
/// Used by the settings UI to show Codex connection status.
#[tauri::command]
pub async fn check_codex_auth(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<bool, String> {
    if read_auth_record().is_some() {
        return Ok(true);
    }
    // Fall back to browser cookie or manual token
    Ok(cache.get_codex_browser_cookie().is_some() || cache.get_codex_manual_token().is_some())
}

/// Save a browser-extracted ChatGPT session cookie.
#[tauri::command]
pub fn save_codex_browser_cookie(
    app: tauri::AppHandle,
    cookie: String,
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<(), String> {
    super::credentials::save_to_store(&app, "codex_browser_cookie", &cookie)?;
    cache.set_codex_browser_cookie(cookie);
    Ok(())
}

/// Read the saved ChatGPT browser session cookie.
#[tauri::command]
pub fn get_codex_browser_cookie(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<Option<String>, String> {
    Ok(cache.get_codex_browser_cookie())
}

/// Validate a browser-extracted ChatGPT cookie by hitting the usage endpoint.
/// `cookie` is a full Cookie header value (already formatted).
#[tauri::command]
pub async fn test_codex_browser_cookie(cookie: String) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(CODEX_USAGE_URL)
        .header("Cookie", &cookie)
        .header("Content-Type", "application/json")
        .header("User-Agent", "UsageWatch/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Codex request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Cookie is invalid or expired.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Codex API returned status {}", response.status()));
    }
    Ok(true)
}

#[tauri::command]
pub async fn fetch_codex_usage(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<CodexUsageData, String> {
    fetch_codex_usage_with_fallbacks(
        cache.get_codex_browser_cookie(),
        cache.get_codex_manual_token(),
    )
    .await
}
