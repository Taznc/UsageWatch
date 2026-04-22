import type { BillingInfo, CodexUsageData, CursorUsageData, UsageData } from "../types/usage";
import type { APIStatus } from "../types/widget";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export const previewUsageData: UsageData = {
  five_hour: { utilization: 97, resets_at: futureIso(1.3) },
  seven_day: { utilization: 72, resets_at: futureIso(61) },
  seven_day_opus: { utilization: 34, resets_at: futureIso(61) },
  seven_day_sonnet: { utilization: 68, resets_at: futureIso(61) },
  seven_day_oauth_apps: { utilization: 21, resets_at: futureIso(61) },
  seven_day_cowork: { utilization: 12, resets_at: futureIso(61) },
  seven_day_omelette: { utilization: 55, resets_at: futureIso(61) },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 2500,
    used_credits: 730,
    utilization: 29.2,
  },
};

export const previewBillingData: BillingInfo = {
  prepaid_credits: {
    amount: 18420,
    currency: "USD",
    auto_reload_settings: null,
  },
  credit_grant: {
    available: true,
    eligible: true,
    granted: true,
    amount_minor_units: 4500,
    currency: "USD",
  },
  bundles: {
    purchases_reset_at: futureIso(61),
    bundle_paid_this_month_minor_units: 1200,
    bundle_monthly_cap_minor_units: 5000,
  },
};

export const previewCodexData: CodexUsageData = {
  plan_type: "pro",
  allowed: true,
  limit_reached: false,
  account_id: "acct_preview_123",
  auth_source: "~/.codex/auth.json",
  last_refresh_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  session_window: {
    used_percent: 64,
    resets_at: futureIso(2.4),
    limit_window_seconds: 18000,
  },
  weekly_window: {
    used_percent: 41,
    resets_at: futureIso(63),
    limit_window_seconds: 604800,
  },
  credits: {
    has_credits: true,
    unlimited: false,
    overage_limit_reached: false,
    balance: "24.50",
  },
  code_review_window: null,
};

export const previewCursorData: CursorUsageData = {
  plan_name: "Enterprise",
  plan_price: "$20/mo",
  plan_included_amount_cents: 11000,
  current_spend_cents: 7352,
  total_spend_cents: 7425,
  bonus_spend_cents: 73,
  limit_cents: 11000,
  plan_remaining_cents: 3648,
  spend_pct: 66.8,
  auto_pct: 45.2,
  api_pct: 21.6,
  remaining_bonus: false,
  bonus_tooltip: null,
  display_message: "You've used 67% of your usage limit",
  on_demand_used_cents: null,
  on_demand_limit_cents: null,
  on_demand_remaining_cents: null,
  on_demand_pooled_used_cents: null,
  on_demand_pooled_limit_cents: null,
  on_demand_pooled_remaining_cents: null,
  on_demand_limit_type: null,
  is_team: false,
  membership_type: "pro",
  subscription_status: "active",
  stripe_balance_cents: null,
  cycle_resets_at: futureIso(420),
  billing_cycle_start: null,
  email: "preview@example.com",
  usage_meter_enabled: true,
  display_threshold_bp: null,
  auto_model_selected_display_message: null,
  named_model_selected_display_message: null,
  connect_extras: null,
  enterprise_usage: null,
};

export const previewStatus: APIStatus = {
  indicator: "none",
  description: "All systems operational",
};
