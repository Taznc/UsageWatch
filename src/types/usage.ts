export interface UsageWindow {
  utilization_pct: number;
  reset_at: string | null;
}

export interface ExtraUsage {
  current_spending: number;
  budget_limit: number;
}

export interface UsageData {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_opus: UsageWindow | null;
  extra_usage: ExtraUsage | null;
}

export interface UsageUpdate {
  data: UsageData | null;
  error: string | null;
  timestamp: string;
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

export type AppView = "popover" | "settings" | "setup";
