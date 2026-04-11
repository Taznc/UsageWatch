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
    pub refresh_token: String,
}

// ── Path resolution ────────────────────────────────────────────────────────

fn codex_auth_path() -> PathBuf {
    // Allow override via CODEX_HOME on any platform
    if let Ok(home) = std::env::var("CODEX_HOME") {
        return PathBuf::from(home).join("auth.json");
    }
    // Unix: $HOME  |  Windows: $USERPROFILE (HOME is not standard on Windows)
    // The Codex CLI (Node.js) uses os.homedir() which maps to USERPROFILE on Windows.
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home_dir.join(".codex").join("auth.json")
}

// ── Token management ───────────────────────────────────────────────────────

async fn do_token_refresh(refresh_token: &str) -> Result<AuthTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(CODEX_TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CODEX_CLIENT_ID,
            "refresh_token": refresh_token,
        }))
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
        refresh_token: resp.refresh_token,
        account_id: None,
    })
}

pub(crate) async fn get_access_token() -> Result<String, String> {
    let path = codex_auth_path();

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| "~/.codex/auth.json not found. Please authenticate with the Codex App or CLI.".to_string())?;

    let mut auth: AuthJson = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse auth.json: {e}"))?;

    let tokens = auth
        .tokens
        .as_ref()
        .ok_or_else(|| "No tokens found in auth.json".to_string())?;

    // Refresh if last_refresh is ≥ 8 days ago (or missing)
    let needs_refresh = auth
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

        auth.tokens = Some(new_tokens);
        auth.last_refresh = Some(chrono::Utc::now().to_rfc3339());

        let updated = serde_json::to_string_pretty(&auth)
            .map_err(|e| format!("Cannot serialize auth: {e}"))?;
        tokio::fs::write(&path, updated)
            .await
            .map_err(|e| format!("Cannot write auth.json: {e}"))?;

        eprintln!("[Codex] Token refreshed and written to auth.json");
        Ok(access_token)
    } else {
        Ok(tokens.access_token.clone())
    }
}

// ── Usage fetch ────────────────────────────────────────────────────────────

pub(crate) async fn fetch_codex_usage_internal() -> Result<CodexUsageData, String> {
    let token = get_access_token().await?;

    let client = reqwest::Client::new();
    let response = client
        .get(CODEX_USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "Claude Usage Tracker/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Codex request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Codex token expired or invalid. Please re-authenticate with the Codex App or CLI.".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("Codex API returned status {}", response.status()));
    }

    let api_resp: CodexApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Codex usage data: {e}"))?;

    Ok(CodexUsageData::from_api(api_resp))
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Returns true if ~/.codex/auth.json exists and contains tokens.
/// Used by the settings UI to show Codex connection status.
#[tauri::command]
pub async fn check_codex_auth() -> Result<bool, String> {
    let path = codex_auth_path();
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let auth: Result<AuthJson, _> = serde_json::from_str(&content);
            Ok(auth.map(|a| a.tokens.is_some()).unwrap_or(false))
        }
        Err(_) => Ok(false),
    }
}
