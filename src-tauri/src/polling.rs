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

            // Update the shared cache so the HTTP server can serve latest data
            *latest_usage.lock().unwrap() = Some(update.clone());

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

        // On macOS: render colored text as NSImage — this avoids setAttributedTitle:
        // and its side effects on TaoTrayTarget event routing. The image size determines
        // button width (via NSVariableStatusItemLength). No plain set_title needed.
        #[cfg(target_os = "macos")]
        {
            let segments = build_styled_segments(data, format);
            crate::styled_tray::set_native_styled_title(&segments);
        }

        // On non-macOS: plain text only
        #[cfg(not(target_os = "macos"))]
        {
            let title = tray_renderer::build_tray_title(data, format);
            let _ = tray.set_title(Some(&title));
        }
    }
}

#[cfg(target_os = "macos")]
fn build_styled_segments(data: &UsageData, format: &TrayFormat) -> Vec<crate::styled_tray::StyledSegment> {
    use crate::styled_tray::StyledSegment;

    let label_color = (220, 220, 230, 255);
    let timer_color = (120, 180, 255, 255); // light blue — distinct from labels
    let sep_color = (150, 150, 160, 255);

    fn pct_color(pct: f64) -> (u8, u8, u8, u8) {
        if pct >= 90.0 { (255, 100, 100, 255) }
        else if pct >= 75.0 { (255, 200, 50, 255) }
        else { (80, 240, 140, 255) }
    }

    let mut groups: Vec<Vec<StyledSegment>> = Vec::new();

    // Session group
    if format.show_session_pct || format.show_session_timer {
        if let Some(ref fh) = data.five_hour {
            let mut segs = Vec::new();
            if format.show_session_pct {
                let (r, g, b, a) = label_color;
                segs.push(StyledSegment::from_rgba_u8("S:", r, g, b, a, 14.0, false));
                let (r, g, b, a) = pct_color(fh.utilization);
                segs.push(StyledSegment::from_rgba_u8(
                    &format!("{}%", fh.utilization.round() as i32),
                    r, g, b, a, 14.0, true,
                ));
            }
            if format.show_session_timer {
                if let Some(ref reset) = fh.resets_at {
                    let cd = tray_renderer::format_countdown_public(reset);
                    if !cd.is_empty() {
                        let (r, g, b, a) = timer_color;
                        segs.push(StyledSegment::from_rgba_u8(
                            &format!(" {}", cd), r, g, b, a, 11.0, false,
                        ));
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Weekly group
    if format.show_weekly_pct || format.show_weekly_timer {
        if let Some(ref sd) = data.seven_day {
            let mut segs = Vec::new();
            if format.show_weekly_pct {
                let (r, g, b, a) = label_color;
                segs.push(StyledSegment::from_rgba_u8("W:", r, g, b, a, 14.0, false));
                let (r, g, b, a) = pct_color(sd.utilization);
                segs.push(StyledSegment::from_rgba_u8(
                    &format!("{}%", sd.utilization.round() as i32),
                    r, g, b, a, 14.0, true,
                ));
            }
            if format.show_weekly_timer {
                if let Some(ref reset) = sd.resets_at {
                    let cd = tray_renderer::format_countdown_public(reset);
                    if !cd.is_empty() {
                        let (r, g, b, a) = timer_color;
                        segs.push(StyledSegment::from_rgba_u8(
                            &format!(" {}", cd), r, g, b, a, 11.0, false,
                        ));
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Sonnet
    if format.show_sonnet_pct {
        if let Some(ref ss) = data.seven_day_sonnet {
            if ss.utilization > 0.0 {
                let (r, g, b, a) = label_color;
                let (pr, pg, pb, pa) = pct_color(ss.utilization);
                groups.push(vec![
                    StyledSegment::from_rgba_u8("So:", r, g, b, a, 14.0, false),
                    StyledSegment::from_rgba_u8(&format!("{}%", ss.utilization.round() as i32), pr, pg, pb, pa, 14.0, true),
                ]);
            }
        }
    }

    // Opus
    if format.show_opus_pct {
        if let Some(ref op) = data.seven_day_opus {
            if op.utilization > 0.0 {
                let (r, g, b, a) = label_color;
                let (pr, pg, pb, pa) = pct_color(op.utilization);
                groups.push(vec![
                    StyledSegment::from_rgba_u8("Op:", r, g, b, a, 14.0, false),
                    StyledSegment::from_rgba_u8(&format!("{}%", op.utilization.round() as i32), pr, pg, pb, pa, 14.0, true),
                ]);
            }
        }
    }

    // Extra usage
    if format.show_extra_usage {
        if let Some(ref eu) = data.extra_usage {
            if eu.is_enabled {
                groups.push(vec![
                    StyledSegment::from_rgba_u8(
                        &format!("${}/{}", (eu.used_credits / 100.0).round() as i32, (eu.monthly_limit / 100.0).round() as i32),
                        139, 92, 246, 255, 12.0, false,
                    ),
                ]);
            }
        }
    }

    // Flatten groups with separators
    let mut result = Vec::new();
    for (i, group) in groups.iter().enumerate() {
        if i > 0 {
            let (r, g, b, a) = sep_color;
            result.push(StyledSegment::from_rgba_u8(&format!(" {} ", format.separator.trim()), r, g, b, a, 13.0, false));
        }
        result.extend(group.iter().cloned());
    }

    result
}
