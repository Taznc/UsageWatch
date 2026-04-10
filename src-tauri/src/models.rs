use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    #[serde(default)]
    pub five_hour: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day_opus: Option<UsageWindow>,
    #[serde(default)]
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    #[serde(default)]
    pub utilization_pct: f64,
    #[serde(default)]
    pub reset_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    #[serde(default)]
    pub current_spending: f64,
    #[serde(default)]
    pub budget_limit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub uuid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct AppSettings {
    pub poll_interval_secs: u64,
    pub show_remaining: bool,
    pub notifications_enabled: bool,
    pub notify_at_75: bool,
    pub notify_at_90: bool,
    pub notify_at_95: bool,
    pub autostart: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            poll_interval_secs: 60,
            show_remaining: false,
            notifications_enabled: true,
            notify_at_75: true,
            notify_at_90: true,
            notify_at_95: true,
            autostart: false,
        }
    }
}
