
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

