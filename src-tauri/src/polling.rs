use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

use crate::credentials_cache::CredentialsCache;
use crate::models::UsageData;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageUpdate {
    pub data: Option<UsageData>,
    pub error: Option<String>,
    pub timestamp: String,
}

pub fn start_polling(app: &AppHandle, poll_interval: Arc<Mutex<u64>>, cache: Arc<CredentialsCache>) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Small initial delay to let the app initialize
        tokio::time::sleep(Duration::from_secs(2)).await;

        loop {
            let secs = { *poll_interval.lock().unwrap() };
            if secs == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }

            // Read credentials from in-memory cache (no keychain access)
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

            // Fetch usage data
            let update = match fetch_usage_internal(&session_key, &org_id).await {
                Ok(data) => {
                    if let Some(ref five_hour) = data.five_hour {
                        update_tray_title(&app_handle, five_hour.utilization);
                    }
                    UsageUpdate {
                        data: Some(data),
                        error: None,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    }
                }
                Err(e) => UsageUpdate {
                    data: None,
                    error: Some(e),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            };

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
        .header("user-agent", "Claude Usage Tracker/0.1.0")
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

fn update_tray_title(app: &AppHandle, pct: f64) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let title = format!("{}%", pct.round() as i32);
        let _ = tray.set_title(Some(&title));
    }
}
