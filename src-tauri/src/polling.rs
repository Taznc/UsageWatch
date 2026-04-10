use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

use crate::credentials_cache::CredentialsCache;
use crate::models::{TrayFormat, UsageData};

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
                    update_tray_title(&app_handle, &data, &format);
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

fn format_countdown(resets_at: &str) -> String {
    let reset = match chrono::DateTime::parse_from_rfc3339(resets_at) {
        Ok(dt) => dt,
        Err(_) => return String::new(),
    };
    let now = chrono::Utc::now();
    let diff = reset.signed_duration_since(now);

    if diff.num_seconds() <= 0 {
        return "now".to_string();
    }

    let hours = diff.num_hours();
    let minutes = diff.num_minutes() % 60;

    if hours > 24 {
        // Show day name for weekly resets
        let day = reset.format("%a").to_string();
        return day;
    }
    if hours > 0 {
        return format!("{}h{}m", hours, minutes);
    }
    format!("{}m", minutes)
}

pub fn update_tray_title_public(app: &AppHandle, data: &UsageData, format: &TrayFormat) {
    update_tray_title(app, data, format);
}

fn update_tray_title(app: &AppHandle, data: &UsageData, format: &TrayFormat) {
    let mut segments: Vec<String> = Vec::new();

    // Session segment
    if format.show_session_pct {
        if let Some(ref fh) = data.five_hour {
            let mut s = format!("S:{}%", fh.utilization.round() as i32);
            if format.show_session_timer {
                if let Some(ref reset) = fh.resets_at {
                    let countdown = format_countdown(reset);
                    if !countdown.is_empty() {
                        s.push(' ');
                        s.push_str(&countdown);
                    }
                }
            }
            segments.push(s);
        }
    }

    // Weekly segment
    if format.show_weekly_pct {
        if let Some(ref sd) = data.seven_day {
            let mut s = format!("W:{}%", sd.utilization.round() as i32);
            if format.show_weekly_timer {
                if let Some(ref reset) = sd.resets_at {
                    let countdown = format_countdown(reset);
                    if !countdown.is_empty() {
                        s.push(' ');
                        s.push_str(&countdown);
                    }
                }
            }
            segments.push(s);
        }
    }

    // Sonnet segment
    if format.show_sonnet_pct {
        if let Some(ref ss) = data.seven_day_sonnet {
            if ss.utilization > 0.0 {
                segments.push(format!("So:{}%", ss.utilization.round() as i32));
            }
        }
    }

    // Opus segment
    if format.show_opus_pct {
        if let Some(ref op) = data.seven_day_opus {
            if op.utilization > 0.0 {
                segments.push(format!("Op:{}%", op.utilization.round() as i32));
            }
        }
    }

    // Extra usage segment
    if format.show_extra_usage {
        if let Some(ref eu) = data.extra_usage {
            if eu.is_enabled {
                segments.push(format!(
                    "${}/{}",
                    (eu.used_credits / 100.0).round() as i32,
                    (eu.monthly_limit / 100.0).round() as i32
                ));
            }
        }
    }

    let title = if segments.is_empty() {
        "--".to_string()
    } else {
        segments.join(&format.separator)
    };

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_title(Some(&title));
    }
}
