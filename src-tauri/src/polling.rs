use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

use crate::credentials_cache::CredentialsCache;
use crate::models::{TrayFormat, UsageData};
use crate::tray_renderer;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageUpdate {
    pub data: Option<UsageData>,
    pub error: Option<String>,
    pub timestamp: String,
}

pub fn start_polling(
    app: &AppHandle,
    poll_interval: Arc<Mutex<u64>>,
    cache: Arc<CredentialsCache>,
    tray_format: Arc<Mutex<TrayFormat>>,
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
                Ok(data) => {
                    let format = tray_format.lock().unwrap().clone();
                    update_tray_display(&app_handle, &data, &format);
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

pub fn update_tray_title_public(app: &AppHandle, data: &UsageData, format: &TrayFormat) {
    update_tray_display(app, data, format);
}

fn update_tray_display(app: &AppHandle, data: &UsageData, format: &TrayFormat) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        // Try styled image rendering, fall back to plain text on failure
        let data_clone = data.clone();
        let format_clone = format.clone();
        let rendered = std::panic::catch_unwind(|| {
            tray_renderer::render_tray_image(&data_clone, &format_clone)
        });

        match rendered {
            Ok(Some(png_bytes)) => {
                if let Ok(img) = tauri::image::Image::from_bytes(&png_bytes) {
                    let _ = tray.set_title(Some(""));
                    let owned = img.to_owned();
                    let _ = tray.set_icon(Some(owned));
                    let _ = tray.set_icon_as_template(false);
                    return;
                }
            }
            Err(e) => {
                eprintln!("[tray] renderer panicked: {:?}", e);
            }
            _ => {}
        }

        // Fallback: plain text
        let pct = data.five_hour.as_ref().map(|f| f.utilization.round() as i32).unwrap_or(0);
        let _ = tray.set_title(Some(&format!("{}%", pct)));
    }
}
