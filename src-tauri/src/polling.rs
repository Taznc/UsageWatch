use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

use crate::credentials_cache::CredentialsCache;
use crate::models::{CodexUsageData, CursorUsageData, UsageData};
use crate::commands;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageUpdate {
    pub data: Option<UsageData>,
    pub error: Option<String>,
    pub timestamp: String,
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

pub fn start_polling(
    app: &AppHandle,
    poll_interval: Arc<Mutex<u64>>,
    cache: Arc<CredentialsCache>,
    latest_usage: Arc<Mutex<Option<UsageUpdate>>>,
) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;

        loop {
            let secs = { *poll_interval.lock().unwrap() };
            if secs == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }

            let session_key = match cache.get_session_key() {
                Some(key) => key,
                None => {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let org_id = match cache.get_org_id() {
                Some(id) => id,
                None => {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let update = match fetch_usage_internal(&session_key, &org_id).await {
                Ok(data) => UsageUpdate {
                    data: Some(data),
                    error: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
                Err(e) => UsageUpdate {
                    data: None,
                    error: Some(e),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            };

            // Update the shared cache so the HTTP server can serve latest data
            *latest_usage.lock().unwrap() = Some(update.clone());

            // Re-render tray for current provider (may be Claude or Codex)
            crate::tray_state::refresh_tray();

            let _ = app_handle.emit("usage-update", &update);

            let mut tick = interval(Duration::from_secs(secs));
            tick.tick().await;
            tick.tick().await;
        }
    });
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

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse usage data: {}", e))
}

pub fn start_codex_polling(
    app: &AppHandle,
    poll_interval: Arc<Mutex<u64>>,
    latest_codex: Arc<Mutex<Option<CodexUpdate>>>,
) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Slight offset from Claude's 2s delay to avoid simultaneous API bursts
        tokio::time::sleep(Duration::from_secs(5)).await;

        loop {
            let secs = { *poll_interval.lock().unwrap() };
            if secs == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }

            let update = match commands::codex::fetch_codex_usage_internal().await {
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
            };

            *latest_codex.lock().unwrap() = Some(update.clone());

            // Re-render tray for current provider
            crate::tray_state::refresh_tray();

            let _ = app_handle.emit("codex-update", &update);

            let mut tick = interval(Duration::from_secs(secs));
            tick.tick().await;
            tick.tick().await;
        }
    });
}

pub fn start_cursor_polling(
    app: &AppHandle,
    poll_interval: Arc<Mutex<u64>>,
    latest_cursor: Arc<Mutex<Option<CursorUpdate>>>,
) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Offset from Claude (2s) and Codex (5s) to avoid simultaneous API bursts
        tokio::time::sleep(Duration::from_secs(8)).await;

        loop {
            let secs = { *poll_interval.lock().unwrap() };
            if secs == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }

            let update = match commands::cursor::fetch_cursor_usage_internal().await {
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
            };

            *latest_cursor.lock().unwrap() = Some(update.clone());

            crate::tray_state::refresh_tray();

            let _ = app_handle.emit("cursor-update", &update);

            let mut tick = interval(Duration::from_secs(secs));
            tick.tick().await;
            tick.tick().await;
        }
    });
}
