export type TileId =
  | "session_window"
  | "weekly_window"
  | "opus_window"
  | "sonnet_window"
  | "oauth_window"
  | "cowork_window"
  | "extra_usage"
  | "prepaid_balance"
  | "promo_credit"
  | "api_status"
  | "codex_session"
  | "codex_weekly"
  | "codex_credits";

export const ALL_TILES: TileId[] = [
  "session_window",
  "weekly_window",
  "opus_window",
  "sonnet_window",
  "oauth_window",
  "cowork_window",
  "extra_usage",
  "prepaid_balance",
  "promo_credit",
  "api_status",
  "codex_session",
  "codex_weekly",
  "codex_credits",
];

export const TILE_LABELS: Record<TileId, string> = {
  session_window: "Session",
  weekly_window: "Weekly",
  opus_window: "Opus",
  sonnet_window: "Sonnet",
  oauth_window: "OAuth Apps",
  cowork_window: "Cowork",
  extra_usage: "Extra Usage",
  prepaid_balance: "Balance",
  promo_credit: "Promo Credit",
  api_status: "API Status",
  codex_session: "Codex Session",
  codex_weekly: "Codex Weekly",
  codex_credits: "Codex Credits",
};

export const DEFAULT_TILES: TileId[] = [
  "session_window",
  "weekly_window",
  "api_status",
];

export interface WidgetLayout {
  version: number;
  placedTiles: TileId[];
  position: { x: number; y: number };
}

// Matches Rust's fetch_status response: { status: { indicator, description }, page: {...} }
export interface APIStatusResponse {
  status: {
    indicator: string; // "none" | "minor" | "major" | "critical"
    description: string;
  };
}

// Flattened form stored in WidgetContext
export interface APIStatus {
  indicator: string;
  description: string;
}
