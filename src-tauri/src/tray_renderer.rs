use crate::models::{TrayFormat, UsageData};

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

pub fn format_countdown_public(resets_at: &str) -> String {
    format_countdown(resets_at)
}

/// Builds the plain text title string for the menu bar (used for clickable area + non-macOS).
pub fn build_tray_title(data: &UsageData, format: &TrayFormat) -> String {
    let mut groups: Vec<String> = Vec::new();

    if format.show_session_pct || format.show_session_timer {
        if let Some(ref fh) = data.five_hour {
            let mut parts: Vec<String> = Vec::new();
            if format.show_session_pct {
                parts.push(format!("S:{}%", fh.utilization.round() as i32));
            }
            if format.show_session_timer {
                if let Some(ref reset) = fh.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() { parts.push(cd); }
                }
            }
            if !parts.is_empty() { groups.push(parts.join(" ")); }
        }
    }

    if format.show_weekly_pct || format.show_weekly_timer {
        if let Some(ref sd) = data.seven_day {
            let mut parts: Vec<String> = Vec::new();
            if format.show_weekly_pct {
                parts.push(format!("W:{}%", sd.utilization.round() as i32));
            }
            if format.show_weekly_timer {
                if let Some(ref reset) = sd.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() { parts.push(cd); }
                }
            }
            if !parts.is_empty() { groups.push(parts.join(" ")); }
        }
    }

    if format.show_sonnet_pct {
        if let Some(ref ss) = data.seven_day_sonnet {
            if ss.utilization > 0.0 {
                groups.push(format!("So:{}%", ss.utilization.round() as i32));
            }
        }
    }

    if format.show_opus_pct {
        if let Some(ref op) = data.seven_day_opus {
            if op.utilization > 0.0 {
                groups.push(format!("Op:{}%", op.utilization.round() as i32));
            }
        }
    }

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

    if groups.is_empty() { "--".to_string() } else { groups.join(&format.separator) }
}
