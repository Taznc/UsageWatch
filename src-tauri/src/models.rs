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
    pub monthly_limit: Option<f64>,
    #[serde(default)]
    pub used_credits: Option<f64>,
    #[serde(default)]
    pub utilization: Option<f64>,
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
    pub account_id: Option<String>,
    pub auth_source: Option<String>,
    pub last_refresh_at: Option<String>,
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
    pub fn from_api(
        api: CodexApiResponse,
        account_id: Option<String>,
        auth_source: Option<String>,
        last_refresh_at: Option<String>,
    ) -> Self {
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
            account_id,
            auth_source,
            last_refresh_at,
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
    pub plan_price: Option<String>,
    pub plan_included_amount_cents: Option<f64>,
    /// Current included spend in cents (counts against plan limit)
    pub current_spend_cents: f64,
    /// Total plan spend in cents (included + bonus/provider credits)
    pub total_spend_cents: Option<f64>,
    /// Bonus/provider-credit spend in cents for this cycle
    pub bonus_spend_cents: Option<f64>,
    /// Plan included-amount limit in cents
    pub limit_cents: f64,
    /// Remaining included amount in cents (from Connect `planUsage.remaining`, when present)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_remaining_cents: Option<f64>,
    /// Spend as a percentage of plan limit
    pub spend_pct: f64,
    /// Auto-mode usage percentage (may be absent on some plan types)
    pub auto_pct: Option<f64>,
    /// API/manual usage percentage (may be absent on some plan types)
    pub api_pct: Option<f64>,
    /// True when bonus credits from model providers are still available
    pub remaining_bonus: bool,
    pub bonus_tooltip: Option<String>,
    pub display_message: Option<String>,
    /// On-demand individual spend this cycle in cents (>0 means over-plan usage)
    pub on_demand_used_cents: Option<f64>,
    /// On-demand individual limit in cents (None = no on-demand budget set)
    pub on_demand_limit_cents: Option<f64>,
    pub on_demand_remaining_cents: Option<f64>,
    pub on_demand_pooled_used_cents: Option<f64>,
    pub on_demand_pooled_limit_cents: Option<f64>,
    pub on_demand_pooled_remaining_cents: Option<f64>,
    pub on_demand_limit_type: Option<String>,
    /// True when the account is a Team plan
    pub is_team: bool,
    pub membership_type: Option<String>,
    pub subscription_status: Option<String>,
    /// Stripe prepaid credit balance in cents (positive = credit available)
    pub stripe_balance_cents: Option<f64>,
    /// When the billing cycle resets (ISO-8601)
    pub cycle_resets_at: Option<String>,
    /// Start of current billing cycle (ISO-8601), from Connect `billingCycleStart`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_cycle_start: Option<String>,
    /// Email of the logged-in Cursor user
    pub email: Option<String>,
    /// Connect `enabled` on usage payload (dashboard meter enabled)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_meter_enabled: Option<bool>,
    /// Connect `displayThreshold` (basis points) when present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_threshold_bp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_model_selected_display_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub named_model_selected_display_message: Option<String>,
    /// Undocumented Connect RPC JSON blobs (limits, grants, credit balance RPC)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connect_extras: Option<serde_json::Value>,
    /// Raw `GET https://cursor.com/api/usage` JSON when the enterprise endpoint returns data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enterprise_usage: Option<serde_json::Value>,
}

/// Internal assembly for [`CursorUsageData::from_assembly`].
#[derive(Debug, Default)]
pub struct CursorUsageAssembly {
    pub plan_name: Option<String>,
    pub plan_price: Option<String>,
    pub plan_included_amount_cents: Option<f64>,
    pub spend_cents: f64,
    pub plan_remaining_cents: Option<f64>,
    pub total_spend_cents: Option<f64>,
    pub bonus_spend_cents: Option<f64>,
    pub limit_cents: f64,
    pub auto_pct: Option<f64>,
    pub api_pct: Option<f64>,
    pub total_pct: Option<f64>,
    pub remaining_bonus: bool,
    pub bonus_tooltip: Option<String>,
    pub display_message: Option<String>,
    pub on_demand_used_cents: Option<f64>,
    pub on_demand_limit_cents: Option<f64>,
    pub on_demand_remaining_cents: Option<f64>,
    pub on_demand_pooled_used_cents: Option<f64>,
    pub on_demand_pooled_limit_cents: Option<f64>,
    pub on_demand_pooled_remaining_cents: Option<f64>,
    pub on_demand_limit_type: Option<String>,
    pub is_team: bool,
    pub membership_type: Option<String>,
    pub subscription_status: Option<String>,
    pub stripe_balance_cents: Option<f64>,
    pub cycle_end: Option<String>,
    pub billing_cycle_start: Option<String>,
    pub email: Option<String>,
    pub usage_meter_enabled: Option<bool>,
    pub display_threshold_bp: Option<f64>,
    pub auto_model_selected_display_message: Option<String>,
    pub named_model_selected_display_message: Option<String>,
    pub connect_extras: Option<serde_json::Value>,
    pub enterprise_usage: Option<serde_json::Value>,
}

impl CursorUsageData {
    pub fn from_assembly(a: CursorUsageAssembly) -> Self {
        let spend_cents = a.spend_cents;
        let limit_cents = a.limit_cents;
        let computed_pct = if limit_cents > 0.0 {
            (spend_cents / limit_cents * 100.0).clamp(0.0, 999.0)
        } else {
            0.0
        };
        // Cursor sometimes returns totalPercentUsed: 0 while planUsage still has spend vs limit.
        let spend_pct = match a.total_pct.filter(|v| v.is_finite()) {
            Some(api_pct) if api_pct > 0.0 || spend_cents <= f64::EPSILON => api_pct,
            Some(_) => computed_pct,
            None => computed_pct,
        };
        Self {
            plan_name: a.plan_name,
            plan_price: a.plan_price,
            plan_included_amount_cents: a.plan_included_amount_cents,
            current_spend_cents: spend_cents,
            plan_remaining_cents: a.plan_remaining_cents,
            total_spend_cents: a.total_spend_cents,
            bonus_spend_cents: a.bonus_spend_cents,
            limit_cents,
            spend_pct,
            auto_pct: a.auto_pct,
            api_pct: a.api_pct,
            remaining_bonus: a.remaining_bonus,
            bonus_tooltip: a.bonus_tooltip,
            display_message: a.display_message,
            on_demand_used_cents: a.on_demand_used_cents,
            on_demand_limit_cents: a.on_demand_limit_cents,
            on_demand_remaining_cents: a.on_demand_remaining_cents,
            on_demand_pooled_used_cents: a.on_demand_pooled_used_cents,
            on_demand_pooled_limit_cents: a.on_demand_pooled_limit_cents,
            on_demand_pooled_remaining_cents: a.on_demand_pooled_remaining_cents,
            on_demand_limit_type: a.on_demand_limit_type,
            is_team: a.is_team,
            membership_type: a.membership_type,
            subscription_status: a.subscription_status,
            stripe_balance_cents: a.stripe_balance_cents,
            cycle_resets_at: a.cycle_end,
            billing_cycle_start: a.billing_cycle_start,
            email: a.email,
            usage_meter_enabled: a.usage_meter_enabled,
            display_threshold_bp: a.display_threshold_bp,
            auto_model_selected_display_message: a.auto_model_selected_display_message,
            named_model_selected_display_message: a.named_model_selected_display_message,
            connect_extras: a.connect_extras,
            enterprise_usage: a.enterprise_usage,
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
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn emoji(&self) -> &'static str {
        match self {
            Provider::Claude => "\u{1F7E0}",  // 🟠
            Provider::Codex => "\u{1F7E2}",   // 🟢
            Provider::Cursor => "\u{1F7E3}",  // 🟣
        }
    }

    #[allow(dead_code)]
    pub fn icon_name(&self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Cursor => "cursor",
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
