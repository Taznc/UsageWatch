// Mirrors Rust JSON output from src-tauri/src/models.rs and polling.rs

// ── Claude ───────────────────────────────────────────────────────────────────

export interface UsageWindow {
  utilization: number;
  resets_at?: string;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number;
}

export interface PeakHoursStatus {
  is_peak: boolean;
  is_off_peak: boolean;
  is_weekend: boolean;
}

export interface UsageData {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_opus?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
  seven_day_oauth_apps?: UsageWindow;
  seven_day_cowork?: UsageWindow;
  extra_usage?: ExtraUsage;
}

export interface UsageUpdate {
  data?: UsageData;
  error?: string;
  timestamp: string;
  peak_hours?: PeakHoursStatus;
}

// ── Codex ────────────────────────────────────────────────────────────────────

export interface CodexUsageWindow {
  used_percent: number;
  resets_at?: string;
  limit_window_seconds: number;
}

export interface CodexCredits {
  has_credits: boolean;
  unlimited: boolean;
  overage_limit_reached: boolean;
  balance?: string;
}

export interface CodexUsageData {
  plan_type?: string;
  allowed: boolean;
  limit_reached: boolean;
  account_id?: string;
  auth_source?: string;
  last_refresh_at?: string;
  session_window?: CodexUsageWindow;
  weekly_window?: CodexUsageWindow;
  credits?: CodexCredits;
  code_review_window?: CodexUsageWindow;
}

export interface CodexUpdate {
  data?: CodexUsageData;
  error?: string;
  timestamp: string;
}

// ── Cursor ───────────────────────────────────────────────────────────────────

export interface CursorUsageData {
  plan_name?: string;
  plan_price?: string;
  plan_included_amount_cents?: number;
  current_spend_cents: number;
  total_spend_cents?: number;
  bonus_spend_cents?: number;
  limit_cents: number;
  spend_pct: number;
  auto_pct?: number;
  api_pct?: number;
  remaining_bonus: boolean;
  bonus_tooltip?: string;
  display_message?: string;
  on_demand_used_cents?: number;
  on_demand_limit_cents?: number;
  on_demand_remaining_cents?: number;
  on_demand_pooled_used_cents?: number;
  on_demand_pooled_limit_cents?: number;
  on_demand_pooled_remaining_cents?: number;
  on_demand_limit_type?: string;
  is_team: boolean;
  membership_type?: string;
  subscription_status?: string;
  stripe_balance_cents?: number;
  cycle_resets_at?: string;
  email?: string;
}

export interface CursorUpdate {
  data?: CursorUsageData;
  error?: string;
  timestamp: string;
}
