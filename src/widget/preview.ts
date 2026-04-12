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
  current_spend_cents: 7352,
  hard_limit_cents: 11000,
  spend_pct: 66.8,
  cycle_resets_at: futureIso(420),
  email: "preview@example.com",
  raw_usage: null,
};

export const previewStatus: APIStatus = {
  indicator: "none",
  description: "All systems operational",
};
