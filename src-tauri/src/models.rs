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
pub struct TrayFormat {
    #[serde(default = "default_true")]
    pub show_session_pct: bool,
    #[serde(default = "default_true")]
    pub show_weekly_pct: bool,
    #[serde(default)]
    pub show_sonnet_pct: bool,
    #[serde(default)]
    pub show_opus_pct: bool,
    #[serde(default = "default_true")]
    pub show_session_timer: bool,
    #[serde(default)]
    pub show_weekly_timer: bool,
    #[serde(default)]
    pub show_extra_usage: bool,
    #[serde(default = "default_separator")]
    pub separator: String,
}

fn default_true() -> bool {
    true
}

fn default_separator() -> String {
    " | ".to_string()
}

impl Default for TrayFormat {
    fn default() -> Self {
        Self {
            show_session_pct: true,
            show_weekly_pct: true,
            show_sonnet_pct: false,
            show_opus_pct: false,
            show_session_timer: true,
            show_weekly_timer: false,
            show_extra_usage: false,
            separator: " | ".to_string(),
        }
    }
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

// ── Codex API response structs (deserialization only) ──────────────────────

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CodexApiWindow {
    #[serde(default)]
    pub used_percent: f64,
    #[serde(default)]
    pub reset_at: i64,
    #[serde(default)]
    pub limit_window_seconds: u64,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CodexApiRateLimit {
    #[serde(default)]
    pub allowed: bool,
    #[serde(default)]
    pub limit_reached: bool,
    pub primary_window: Option<CodexApiWindow>,
    pub secondary_window: Option<CodexApiWindow>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CodexApiCredits {
    #[serde(default)]
    pub has_credits: bool,
    #[serde(default)]
    pub unlimited: bool,
    #[serde(default)]
    pub overage_limit_reached: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CodexApiResponse {
    pub plan_type: Option<String>,
    pub rate_limit: Option<CodexApiRateLimit>,
    pub credits: Option<CodexApiCredits>,
    pub code_review_rate_limit: Option<CodexApiWindow>,
}

// ── Codex frontend-ready structs (serialization only) ─────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexUsageWindow {
    pub used_percent: f64,
    /// ISO-8601 string, converted from Unix timestamp in Rust
    pub resets_at: Option<String>,
    pub limit_window_seconds: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexCredits {
    pub has_credits: bool,
    pub unlimited: bool,
    pub overage_limit_reached: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexUsageData {
    pub plan_type: Option<String>,
    pub allowed: bool,
    pub limit_reached: bool,
    pub session_window: Option<CodexUsageWindow>,
    pub weekly_window: Option<CodexUsageWindow>,
    pub credits: Option<CodexCredits>,
    pub code_review_window: Option<CodexUsageWindow>,
}

fn unix_to_iso(ts: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339())
}

fn convert_api_window(w: CodexApiWindow) -> CodexUsageWindow {
    CodexUsageWindow {
        used_percent: w.used_percent,
        resets_at: unix_to_iso(w.reset_at),
        limit_window_seconds: w.limit_window_seconds,
    }
}

impl CodexUsageData {
    pub fn from_api(api: CodexApiResponse) -> Self {
        let (allowed, limit_reached, session_window, weekly_window) =
            if let Some(rl) = api.rate_limit {
                (
                    rl.allowed,
                    rl.limit_reached,
                    rl.primary_window.map(convert_api_window),
                    rl.secondary_window.map(convert_api_window),
                )
            } else {
                (true, false, None, None)
            };

        let credits = api.credits.map(|c| CodexCredits {
            has_credits: c.has_credits,
            unlimited: c.unlimited,
            overage_limit_reached: c.overage_limit_reached,
            balance: c.balance,
        });

        let code_review_window = api.code_review_rate_limit.map(convert_api_window);

        CodexUsageData {
            plan_type: api.plan_type,
            allowed,
            limit_reached,
            session_window,
            weekly_window,
            credits,
            code_review_window,
        }
    }
}

// ── Cursor frontend-ready structs (serialization only) ──────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct CursorUsageData {
    pub plan_name: Option<String>,
    /// Current total spend in cents for this billing cycle
    pub current_spend_cents: f64,
    /// Hard spending limit in cents (e.g. $110 = 11000)
    pub hard_limit_cents: f64,
    /// Spend as a percentage of hard limit (for UsageBar)
    pub spend_pct: f64,
    /// When the billing cycle resets (ISO-8601)
    pub cycle_resets_at: Option<String>,
    /// Email of the logged-in Cursor user
    pub email: Option<String>,
    /// Raw usage summary for optional detail display
    pub raw_usage: Option<serde_json::Value>,
}

impl CursorUsageData {
    pub fn build(
        spend_cents: f64,
        limit_cents: f64,
        plan: Option<String>,
        cycle_end: Option<String>,
        email: Option<String>,
        raw_usage: Option<serde_json::Value>,
    ) -> Self {
        let spend_pct = if limit_cents > 0.0 {
            (spend_cents / limit_cents * 100.0).clamp(0.0, 999.0)
        } else {
            0.0
        };
        Self {
            plan_name: plan,
            current_spend_cents: spend_cents,
            hard_limit_cents: limit_cents,
            spend_pct,
            cycle_resets_at: cycle_end,
            email,
            raw_usage,
        }
    }
}

// ── Alert configuration ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertConfig {
    /// Master toggle
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Session (5h) usage % threshold — alert when exceeded (0 = disabled)
    #[serde(default = "default_session_threshold")]
    pub session_threshold: u32,
    /// Weekly (7d) usage % threshold — alert when exceeded (0 = disabled)
    #[serde(default = "default_weekly_threshold")]
    pub weekly_threshold: u32,
    /// Alert when estimated time-to-limit drops below this many minutes (0 = disabled)
    #[serde(default)]
    pub burn_rate_mins: u32,
    /// Notify when a usage window resets after being near/at the limit
    #[serde(default = "default_true")]
    pub notify_on_reset: bool,
}

fn default_session_threshold() -> u32 { 80 }
fn default_weekly_threshold() -> u32 { 80 }

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            session_threshold: 80,
            weekly_threshold: 80,
            burn_rate_mins: 30,
            notify_on_reset: true,
        }
    }
}

// ── Peak hours status (from PromoClock supplemental API) ──────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeakHoursStatus {
    pub is_peak: bool,
    pub is_off_peak: bool,
    pub is_weekend: bool,
}

// ── Browser scan result (shared by Claude + Cursor browser extraction) ─────

#[derive(Debug, Clone, Serialize)]
pub struct BrowserResult {
    pub browser: String,
    pub session_key: Option<String>,
    /// Debug info: how many cookies found, key prefix, key length
    pub debug: Option<String>,
}

// ── Provider switching types ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Provider {
    Claude,
    Codex,
    Cursor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppMapping {
    pub app_identifier: String,   // bundle ID (com.googlecode.iterm2) or app name
    pub provider: Provider,
    #[serde(default)]
    pub title_pattern: Option<String>, // optional window title substring (case-insensitive)
}

// ── Multi-provider tray segment types ──────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrayField {
    SessionPct,
    SessionTimer,
    WeeklyPct,
    WeeklyTimer,
    SonnetPct,
    OpusPct,
    ExtraUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TraySegmentKind {
    ProviderData { provider: Provider, field: TrayField },
    CustomText { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraySegmentDef {
    pub kind: TraySegmentKind,
}

impl Provider {
    pub fn emoji(&self) -> &'static str {
        match self {
            Provider::Claude => "\u{1F7E0}",  // 🟠
            Provider::Codex => "\u{1F7E2}",   // 🟢
            Provider::Cursor => "\u{1F7E3}",  // 🟣
        }
    }

    pub fn default_segments(&self) -> Vec<TraySegmentDef> {
        vec![
            TraySegmentDef {
                kind: TraySegmentKind::ProviderData {
                    provider: *self,
                    field: TrayField::SessionPct,
                },
            },
            TraySegmentDef {
                kind: TraySegmentKind::ProviderData {
                    provider: *self,
                    field: TrayField::SessionTimer,
                },
            },
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TrayMode {
    Dynamic,
    Static(Provider),
    Multi(Vec<TraySegmentDef>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayConfig {
    pub mode: TrayMode,
    pub app_mappings: Vec<AppMapping>,
    pub default_provider: Provider,
    #[serde(default)]
    pub title_matching_enabled: bool,
}

impl Default for TrayConfig {
    fn default() -> Self {
        let mapping = |id: &str, provider: Provider| AppMapping {
            app_identifier: id.to_string(),
            provider,
            title_pattern: None,
        };
        Self {
            mode: TrayMode::Dynamic,
            app_mappings: vec![
                mapping("com.anthropic.claudefordesktop", Provider::Claude),
                mapping("com.openai.codex", Provider::Codex),
                // Cursor uses ToDesktop packaging on macOS
                mapping("com.todesktop.230313mzl4w4u92", Provider::Cursor),
                mapping("Claude", Provider::Claude),
                mapping("Claude.exe", Provider::Claude),
                mapping("Codex", Provider::Codex),
                mapping("Codex.exe", Provider::Codex),
                mapping("Cursor", Provider::Cursor),
                mapping("Cursor.exe", Provider::Cursor),
            ],
            default_provider: Provider::Claude,
            title_matching_enabled: false,
        }
    }
}

impl TrayConfig {
    fn normalize_identifier(value: &str) -> String {
        value
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(value)
            .trim()
            .trim_end_matches(".app")
            .trim_end_matches(".lnk")
            .trim_end_matches(".exe")
            .to_ascii_lowercase()
    }

    pub fn match_provider(
        &self,
        bundle_id: Option<&str>,
        app_name: Option<&str>,
        window_title: Option<&str>,
    ) -> Option<Provider> {
        let app_matches = |mapping: &AppMapping| -> bool {
            let mapping_id = Self::normalize_identifier(&mapping.app_identifier);
            bundle_id.map(|b| Self::normalize_identifier(b) == mapping_id).unwrap_or(false)
                || app_name.map(|n| Self::normalize_identifier(n) == mapping_id).unwrap_or(false)
        };

        // Pass 1: title-pattern-aware mappings (most specific — require both app + title match).
        if self.title_matching_enabled {
            for mapping in &self.app_mappings {
                if let Some(pattern) = &mapping.title_pattern {
                    if app_matches(mapping) {
                        if let Some(title) = window_title {
                            if title.to_ascii_lowercase().contains(&pattern.to_ascii_lowercase()) {
                                return Some(mapping.provider);
                            }
                        }
                    }
                }
            }
        }

        // Pass 2: app-identifier-only mappings (no title constraint).
        for mapping in &self.app_mappings {
            if mapping.title_pattern.is_none() && app_matches(mapping) {
                return Some(mapping.provider);
            }
        }

        None
    }

    /// Returns the effective list of segments for Multi/Static modes.
    pub fn effective_segments(&self) -> Option<Vec<TraySegmentDef>> {
        match &self.mode {
            TrayMode::Multi(segs) => Some(segs.clone()),
            TrayMode::Static(p) => Some(p.default_segments()),
            TrayMode::Dynamic => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningApp {
    pub bundle_id: String,
    pub name: String,
}
