import type { Provider } from "./usage";

export interface APIStatusResponse {
  status: {
    indicator: string;
    description: string;
  };
}

export interface APIStatus {
  indicator: string;
  description: string;
}

export type WidgetDensity = "ultra-compact" | "compact" | "comfortable";
export type WidgetThemeLayoutFamily =
  | "slab-stack"
  | "meter-column"
  | "micro-rail"
  | "telemetry-panel"
  | "matrix-rain"
  | "dial-cluster";
export type WidgetThemeHeaderStyle = "capsule" | "tower" | "rail" | "ghost" | "panel" | "matrix" | "dial";
export type WidgetThemeId =
  | "rainmeter-stack"
  | "gauge-tower"
  | "side-rail"
  | "mono-ticker"
  | "signal-deck"
  | "matrix-rain";
export type WidgetCardId = "session" | "weekly" | "extra" | "balance" | "credits" | "status";
export type WidgetThemeOverrideValue = string | number | boolean;

export const ALL_WIDGET_THEME_IDS: WidgetThemeId[] = [
  "rainmeter-stack",
  "gauge-tower",
  "side-rail",
  "mono-ticker",
  "signal-deck",
  "matrix-rain",
];

export interface WidgetCardVisibilityMap extends Record<WidgetCardId, boolean> {}
export interface WidgetProviderCardVisibility extends Record<Provider, WidgetCardVisibilityMap> {}

export interface WidgetThemeOverrideMap extends Partial<Record<WidgetThemeId, Record<string, WidgetThemeOverrideValue>>> {}

export interface WidgetOverlayLayout {
  version: number;
  position: { x: number; y: number };
  themeId: WidgetThemeId;
  density: WidgetDensity;
  scale: number;
  cardOrder: WidgetCardId[];
  cardVisibility: WidgetProviderCardVisibility;
  themeOverrides: WidgetThemeOverrideMap;
}

export interface WidgetCardDefinition {
  id: WidgetCardId;
  title: string;
  shortTitle?: string;
  provider: Provider;
  accent: string;
  icon: string;
  primary: string;
  secondary?: string;
  progress?: number | null;
  tone?: "default" | "muted";
}

export interface WidgetCardViewModel extends WidgetCardDefinition {
  visible: boolean;
}

export const ALL_WIDGET_CARD_IDS: WidgetCardId[] = [
  "session",
  "weekly",
  "extra",
  "balance",
  "credits",
  "status",
];

export const DEFAULT_WIDGET_CARD_ORDER: WidgetCardId[] = [...ALL_WIDGET_CARD_IDS];
export const WIDGET_PROVIDER_CARD_IDS: Record<Provider, WidgetCardId[]> = {
  Claude: ["session", "weekly", "extra", "balance", "status"],
  Codex: ["session", "weekly", "credits", "status"],
  Cursor: ["session", "status"],
};

const DEFAULT_CARD_VISIBILITY: WidgetProviderCardVisibility = {
  Claude: {
    session: true,
    weekly: true,
    extra: true,
    balance: false,
    credits: false,
    status: false,
  },
  Codex: {
    session: true,
    weekly: true,
    extra: false,
    balance: false,
    credits: true,
    status: false,
  },
  Cursor: {
    session: true,
    weekly: false,
    extra: false,
    balance: false,
    credits: false,
    status: false,
  },
};

export const DEFAULT_WIDGET_OVERLAY_LAYOUT: WidgetOverlayLayout = {
  version: 3,
  position: { x: 200, y: 100 },
  themeId: "rainmeter-stack",
  density: "ultra-compact",
  scale: 0.85,
  cardOrder: DEFAULT_WIDGET_CARD_ORDER,
  cardVisibility: DEFAULT_CARD_VISIBILITY,
  themeOverrides: {},
};
