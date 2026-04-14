export interface UsageWindow {
  utilization: number;
  resets_at: string | null;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number;
}

export interface UsageData {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_oauth_apps: UsageWindow | null;
  seven_day_cowork: UsageWindow | null;
  extra_usage: ExtraUsage | null;
}

export interface PeakHoursStatus {
  is_peak: boolean;
  is_off_peak: boolean;
  is_weekend: boolean;
}

export interface UsageUpdate {
  data: UsageData | null;
  error: string | null;
  timestamp: string;
  peak_hours?: PeakHoursStatus | null;
}

export interface PrepaidCredits {
  amount: number;
  currency: string | null;
  auto_reload_settings: unknown;
}

export interface CreditGrant {
  available: boolean;
  eligible: boolean;
  granted: boolean;
  amount_minor_units: number;
  currency: string | null;
}

export interface BundlesInfo {
  purchases_reset_at: string | null;
  bundle_paid_this_month_minor_units: number;
  bundle_monthly_cap_minor_units: number;
}

export interface BillingInfo {
  prepaid_credits: PrepaidCredits | null;
  credit_grant: CreditGrant | null;
  bundles: BundlesInfo | null;
}

export interface Organization {
  uuid: string;
  name: string;
}

export interface AppSettings {
  poll_interval_secs: number;
  show_remaining: boolean;
  notifications_enabled: boolean;
  notify_at_75: boolean;
  notify_at_90: boolean;
  notify_at_95: boolean;
  autostart: boolean;
}

export interface TrayFormat {
  show_session_pct: boolean;
  show_weekly_pct: boolean;
  show_sonnet_pct: boolean;
  show_opus_pct: boolean;
  show_session_timer: boolean;
  show_weekly_timer: boolean;
  show_extra_usage: boolean;
  separator: string;
}

export type AppView = "popover" | "settings";

// ── Codex ─────────────────────────────────────────────────────────────────

export interface CodexUsageWindow {
  used_percent: number;
  resets_at: string | null;
  limit_window_seconds: number;
}

export interface CodexCredits {
  has_credits: boolean;
  unlimited: boolean;
  overage_limit_reached: boolean;
  balance: string | null;
}

export interface CodexUsageData {
  plan_type: string | null;
  allowed: boolean;
  limit_reached: boolean;
  account_id: string | null;
  auth_source: string | null;
  last_refresh_at: string | null;
  session_window: CodexUsageWindow | null;
  weekly_window: CodexUsageWindow | null;
  credits: CodexCredits | null;
  code_review_window: CodexUsageWindow | null;
}

export interface CodexUpdate {
  data: CodexUsageData | null;
  error: string | null;
  timestamp: string;
}

// ── Cursor ───────────────────────────────────────────────────────────────────

export interface CursorUsageData {
  plan_name: string | null;
  plan_price: string | null;
  plan_included_amount_cents: number | null;
  current_spend_cents: number;
  total_spend_cents: number | null;
  bonus_spend_cents: number | null;
  limit_cents: number;
  spend_pct: number;
  auto_pct: number | null;
  api_pct: number | null;
  remaining_bonus: boolean;
  bonus_tooltip: string | null;
  display_message: string | null;
  on_demand_used_cents: number | null;
  on_demand_limit_cents: number | null;
  on_demand_remaining_cents: number | null;
  on_demand_pooled_used_cents: number | null;
  on_demand_pooled_limit_cents: number | null;
  on_demand_pooled_remaining_cents: number | null;
  on_demand_limit_type: string | null;
  is_team: boolean;
  membership_type: string | null;
  subscription_status: string | null;
  stripe_balance_cents: number | null;
  cycle_resets_at: string | null;
  email: string | null;
}

export interface CursorUpdate {
  data: CursorUsageData | null;
  error: string | null;
  timestamp: string;
}

// ── Alert configuration ─────────────────────────────────────────────────────

export interface AlertConfig {
  enabled: boolean;
  session_threshold: number;   // 0-100, 0 = disabled
  weekly_threshold: number;    // 0-100, 0 = disabled
  burn_rate_mins: number;      // minutes, 0 = disabled
  notify_on_reset: boolean;
}

// ── Provider switching types ────────────────────────────────────────────────

export type Provider = "Claude" | "Codex" | "Cursor";

export interface AppMapping {
  app_identifier: string;
  provider: Provider;
  title_pattern?: string;
}

export type TrayField =
  | "SessionPct"
  | "SessionTimer"
  | "WeeklyPct"
  | "WeeklyTimer"
  | "SonnetPct"
  | "OpusPct"
  | "ExtraUsage";

export type TraySegmentKind =
  | { type: "ProviderData"; provider: Provider; field: TrayField }
  | { type: "CustomText"; text: string };

export interface TraySegmentDef {
  kind: TraySegmentKind;
}

export type TrayMode = "Dynamic" | { Static: Provider } | { Multi: TraySegmentDef[] };

export interface TrayConfig {
  mode: TrayMode;
  app_mappings: AppMapping[];
  default_provider: Provider;
  title_matching_enabled: boolean;
}

export interface RunningApp {
  bundle_id: string;
  name: string;
}
