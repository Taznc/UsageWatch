
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

pub fn format_countdown_public(resets_at: &str) -> String {
    format_countdown(resets_at)
}

