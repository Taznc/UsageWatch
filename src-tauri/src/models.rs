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
    pub seven_day_sonnet: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day_oauth_apps: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day_cowork: Option<UsageWindow>,
    #[serde(default)]
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    #[serde(default)]
    pub utilization: f64,
    #[serde(default)]
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default)]
    pub monthly_limit: f64,
    #[serde(default)]
    pub used_credits: f64,
    #[serde(default)]
    pub utilization: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepaidCredits {
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub auto_reload_settings: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditGrant {
    #[serde(default)]
    pub available: bool,
    #[serde(default)]
    pub eligible: bool,
    #[serde(default)]
    pub granted: bool,
    #[serde(default)]
    pub amount_minor_units: f64,
    #[serde(default)]
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundlesInfo {
    #[serde(default)]
    pub purchases_reset_at: Option<String>,
    #[serde(default)]
    pub bundle_paid_this_month_minor_units: f64,
    #[serde(default)]
    pub bundle_monthly_cap_minor_units: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingInfo {
    pub prepaid_credits: Option<PrepaidCredits>,
    pub credit_grant: Option<CreditGrant>,
    pub bundles: Option<BundlesInfo>,
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
