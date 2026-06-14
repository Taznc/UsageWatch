
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
        let days = hours / 24;
        let rem = hours % 24;
        if rem > 0 { format!("{} days {} hr", days, rem) } else { format!("{} days", days) }
    } else if hours > 0 {
        if minutes > 0 { format!("{} hr {} min", hours, minutes) } else { format!("{} hr", hours) }
    } else {
        format!("{} min", minutes)
    }
}

/// Compact countdown: "now", "22m", "2h9m", "3h", "1d3h", "2d".
/// Days kick in at 24h (not 48h like the verbose form) so weekly resets read as
/// "1d3h" rather than "27 hr".
fn format_countdown_compact(resets_at: &str) -> String {
    let reset = match chrono::DateTime::parse_from_rfc3339(resets_at) {
        Ok(dt) => dt,
        Err(_) => return String::new(),
    };
    let now = chrono::Utc::now();
    let diff = reset.signed_duration_since(now);
    if diff.num_seconds() <= 0 {
        return "now".to_string();
    }
    let total_hours = diff.num_hours();
    let minutes = diff.num_minutes() % 60;
    if total_hours >= 24 {
        let days = total_hours / 24;
        let rem_hours = total_hours % 24;
        if rem_hours > 0 { format!("{}d{}h", days, rem_hours) } else { format!("{}d", days) }
    } else if total_hours >= 1 {
        if minutes > 0 { format!("{}h{}m", total_hours, minutes) } else { format!("{}h", total_hours) }
    } else {
        format!("{}m", minutes)
    }
}

/// Format a reset countdown, choosing the compact form when `abbreviated`.
pub fn format_countdown_public(resets_at: &str, abbreviated: bool) -> String {
    if abbreviated {
        format_countdown_compact(resets_at)
    } else {
        format_countdown(resets_at)
    }
}

