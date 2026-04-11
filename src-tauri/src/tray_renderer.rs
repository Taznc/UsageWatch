use tiny_skia::{Pixmap, Color};

use crate::models::{TrayFormat, UsageData};

const ICON_SIZE: u32 = 22;

fn color_u8(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color::from_rgba(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        a as f32 / 255.0,
    )
    .unwrap_or(Color::WHITE)
}

fn usage_color(pct: f64) -> Color {
    if pct >= 90.0 {
        color_u8(255, 85, 85, 255)
    } else if pct >= 75.0 {
        color_u8(255, 180, 30, 255)
    } else {
        color_u8(60, 220, 120, 255)
    }
}

/// Renders a small color-coded dot icon for the tray.
/// The dot color reflects the session usage level.
pub fn render_status_icon(data: &UsageData) -> Option<Vec<u8>> {
    let pct = data.five_hour.as_ref().map(|f| f.utilization).unwrap_or(0.0);
    let color = usage_color(pct);

    let size = ICON_SIZE;
    let mut pixmap = Pixmap::new(size, size)?;

    // Draw a filled circle in the center
    let cx = size as f32 / 2.0;
    let cy = size as f32 / 2.0;
    let radius = 5.0_f32;

    let r = (color.red() * 255.0) as u8;
    let g = (color.green() * 255.0) as u8;
    let b = (color.blue() * 255.0) as u8;

    let data = pixmap.data_mut();
    for py in 0..size {
        for px in 0..size {
            let dx = px as f32 - cx;
            let dy = py as f32 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= radius {
                // Solid inside
                let idx = (py * size + px) as usize * 4;
                let a = 255u8;
                let af = a as f32 / 255.0;
                data[idx] = (r as f32 * af) as u8;
                data[idx + 1] = (g as f32 * af) as u8;
                data[idx + 2] = (b as f32 * af) as u8;
                data[idx + 3] = a;
            } else if dist <= radius + 1.0 {
                // Anti-aliased edge
                let edge = 1.0 - (dist - radius);
                let a = (edge * 255.0) as u8;
                let af = a as f32 / 255.0;
                let idx = (py * size + px) as usize * 4;
                data[idx] = (r as f32 * af) as u8;
                data[idx + 1] = (g as f32 * af) as u8;
                data[idx + 2] = (b as f32 * af) as u8;
                data[idx + 3] = a;
            }
        }
    }

    pixmap.encode_png().ok()
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
    if hours >= 48 {
        format!("{}d{}h", hours / 24, hours % 24)
    } else if hours > 0 {
        format!("{}h{}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

/// Builds the plain text title string for the menu bar.
pub fn build_tray_title(data: &UsageData, format: &TrayFormat) -> String {
    let mut groups: Vec<String> = Vec::new();

    // Session group
    if format.show_session_pct || format.show_session_timer {
        if let Some(ref fh) = data.five_hour {
            let mut parts: Vec<String> = Vec::new();
            if format.show_session_pct {
                parts.push(format!("S:{}%", fh.utilization.round() as i32));
            }
            if format.show_session_timer {
                if let Some(ref reset) = fh.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() {
                        parts.push(cd);
                    }
                }
            }
            if !parts.is_empty() {
                groups.push(parts.join(" "));
            }
        }
    }

    // Weekly group
    if format.show_weekly_pct || format.show_weekly_timer {
        if let Some(ref sd) = data.seven_day {
            let mut parts: Vec<String> = Vec::new();
            if format.show_weekly_pct {
                parts.push(format!("W:{}%", sd.utilization.round() as i32));
            }
            if format.show_weekly_timer {
                if let Some(ref reset) = sd.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() {
                        parts.push(cd);
                    }
                }
            }
            if !parts.is_empty() {
                groups.push(parts.join(" "));
            }
        }
    }

    // Sonnet
    if format.show_sonnet_pct {
        if let Some(ref ss) = data.seven_day_sonnet {
            if ss.utilization > 0.0 {
                groups.push(format!("So:{}%", ss.utilization.round() as i32));
            }
        }
    }

    // Opus
    if format.show_opus_pct {
        if let Some(ref op) = data.seven_day_opus {
            if op.utilization > 0.0 {
                groups.push(format!("Op:{}%", op.utilization.round() as i32));
            }
        }
    }

    // Extra usage
    if format.show_extra_usage {
        if let Some(ref eu) = data.extra_usage {
            if eu.is_enabled {
                groups.push(format!(
                    "${}/{}",
                    (eu.used_credits / 100.0).round() as i32,
                    (eu.monthly_limit / 100.0).round() as i32
                ));
            }
        }
    }

    if groups.is_empty() {
        "--".to_string()
    } else {
        groups.join(&format.separator)
    }
}
