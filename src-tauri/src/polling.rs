use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{Duration, Instant};

use crate::credentials_cache::CredentialsCache;
use crate::models::{BillingInfo, CodexUsageData, CursorUsageData, PeakHoursStatus, UsageData};
use crate::commands;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageUpdate {
    pub data: Option<UsageData>,
    pub error: Option<String>,
    pub timestamp: String,
    pub peak_hours: Option<PeakHoursStatus>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexUpdate {
    pub data: Option<CodexUsageData>,
    pub error: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CursorUpdate {
    pub data: Option<CursorUsageData>,
    pub error: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BillingUpdate {
    pub data: Option<BillingInfo>,
    pub error: Option<String>,
    pub timestamp: String,
}

async fn fetch_billing_update(cache: &CredentialsCache) -> Option<BillingUpdate> {
    let auth_method = cache.get_claude_auth_method();
    if auth_method == "oauth" {
        return None; // billing fetch requires session key, not available via OAuth
    }
    let (session_key, org_id) = match (cache.get_session_key(), cache.get_org_id()) {
        (Some(sk), Some(oid)) => (sk, oid),
        _ => return None,
    };
    match commands::usage::fetch_billing(session_key, org_id).await {
        Ok(info) => Some(BillingUpdate {
            data: Some(info),
            error: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }),
        Err(e) => Some(BillingUpdate {
            data: None,
            error: Some(e),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }),
    }
}

async fn fetch_claude_update(cache: &CredentialsCache) -> Option<UsageUpdate> {
    let auth_method = cache.get_claude_auth_method();

    let usage_result: Result<UsageData, String> = if auth_method == "oauth" {
        match commands::claude_oauth::get_claude_oauth_token().await {
            Ok(token) => commands::usage::fetch_usage_oauth(&token).await,
            Err(e) => Err(e),
        }
    } else {
        let (session_key, org_id) = match (cache.get_session_key(), cache.get_org_id()) {
            (Some(sk), Some(oid)) => (sk, oid),
            _ => return None,
        };
        fetch_usage_internal(&session_key, &org_id).await
    };

    let peak_hours = commands::usage::fetch_peak_hours().await;

    Some(match usage_result {
        Ok(data) => UsageUpdate {
            data: Some(data),
            error: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            peak_hours,
        },
        Err(e) => UsageUpdate {
            data: None,
            error: Some(e),
            timestamp: chrono::Utc::now().to_rfc3339(),
            peak_hours,
        },
    })
}

async fn fetch_codex_update(cache: &CredentialsCache) -> CodexUpdate {
    let browser_cookie = cache.get_codex_browser_cookie();
    let manual_token = cache.get_codex_manual_token();
    match commands::codex::fetch_codex_usage_with_fallbacks(browser_cookie, manual_token).await {
        Ok(data) => CodexUpdate {
            data: Some(data),
            error: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        },
        Err(e) => {
            eprintln!("[Codex] Usage fetch failed: {e}");
            CodexUpdate {
                data: None,
                error: Some(e),
                timestamp: chrono::Utc::now().to_rfc3339(),
            }
        }
    }
}

async fn fetch_cursor_update(cache: &CredentialsCache) -> CursorUpdate {
    let manual_token = cache.get_cursor_manual_token();
    match commands::cursor::fetch_cursor_usage_internal(manual_token).await {
        Ok(data) => CursorUpdate {
            data: Some(data),
            error: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        },
        Err(e) => {
            eprintln!("[Cursor] Usage fetch failed: {e}");
            CursorUpdate {
                data: None,
                error: Some(e),
                timestamp: chrono::Utc::now().to_rfc3339(),
            }
        }
    }
}

/// Fetches Claude, Codex, and Cursor usage concurrently, updates caches, emits events, and refreshes the tray.
pub async fn poll_all_providers(
    app: &AppHandle,
    cache: &CredentialsCache,
    latest_usage: &Arc<Mutex<Option<UsageUpdate>>>,
    latest_codex: &Arc<Mutex<Option<CodexUpdate>>>,
    latest_cursor: &Arc<Mutex<Option<CursorUpdate>>>,
    latest_billing: &Arc<Mutex<Option<BillingUpdate>>>,
) {
    let (claude_opt, codex_update, cursor_update, billing_opt) = tokio::join!(
        fetch_claude_update(cache),
        fetch_codex_update(cache),
        fetch_cursor_update(cache),
        fetch_billing_update(cache),
    );

    if let Some(update) = claude_opt {
        *latest_usage.lock().unwrap() = Some(update.clone());
        let _ = app.emit("usage-update", &update);
    }

    *latest_codex.lock().unwrap() = Some(codex_update.clone());
    let _ = app.emit("codex-update", &codex_update);

    *latest_cursor.lock().unwrap() = Some(cursor_update.clone());
    let _ = app.emit("cursor-update", &cursor_update);

    if let Some(update) = billing_opt {
        *latest_billing.lock().unwrap() = Some(update);
    }

    crate::tray_state::refresh_tray();
}

async fn fetch_usage_internal(session_key: &str, org_id: &str) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);

    let response = client
        .get(&url)
        .header("cookie", format!("sessionKey={}", session_key))
        .header("content-type", "application/json")
        .header("user-agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned status {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse usage data: {}. Raw: {}", e, &text[..text.len().min(500)]))
}

/// Single background loop: one aligned tick for all providers (parallel fetches), same interval as user settings.
pub fn start_unified_polling(
    app: &AppHandle,
    poll_interval: Arc<Mutex<u64>>,
    cache: Arc<CredentialsCache>,
    latest_usage: Arc<Mutex<Option<UsageUpdate>>>,
    latest_codex: Arc<Mutex<Option<CodexUpdate>>>,
    latest_cursor: Arc<Mutex<Option<CursorUpdate>>>,
    latest_billing: Arc<Mutex<Option<BillingUpdate>>>,
) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Let tray and credential store finish settling, then refresh all providers once at startup.
        tokio::time::sleep(Duration::from_millis(400)).await;

        let mut next_tick = Instant::now();

        loop {
            let secs = { *poll_interval.lock().unwrap() };
            if secs == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                next_tick = Instant::now();
                continue;
            }

            // Align to the configured interval even if a poll runs long.
            tokio::time::sleep_until(next_tick).await;

            poll_all_providers(
                &app_handle,
                cache.as_ref(),
                &latest_usage,
                &latest_codex,
                &latest_cursor,
                &latest_billing,
            )
            .await;

            next_tick += Duration::from_secs(secs);
            if next_tick <= Instant::now() {
                next_tick = Instant::now();
            }
        }
    });
}
