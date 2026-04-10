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
