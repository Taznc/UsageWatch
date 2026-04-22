import type { Provider } from "./usage";

export interface APIStatus {
  indicator: string;
  description: string;
}

export type WidgetDensity = "ultra-compact" | "compact" | "comfortable";
export type WidgetThemeLayoutFamily =
  | "slab-stack"
  | "micro-rail"
  | "orbit-gauges"
  | "pinboard-mini"
  | "terminal-deck";
export type WidgetThemeHeaderStyle =
  | "capsule"
  | "rail"
  | "ghost"
  | "panel"
  | "terminal"
  | "orbit";
export type WidgetHeaderBadgeStyle = "glass" | "solid" | "ghost" | "terminal";
export type WidgetHeaderBadgeMode = "brand" | "mono";
export type WidgetResetDisplayMode = "time" | "countdown" | "both";
export type WidgetThemeId =
  | "rainmeter-stack"
  | "orbit-gauges"
  | "side-rail"
  | "mono-ticker"
  | "pinboard-mini"
  | "terminal-deck";
export type WidgetCardId = "session" | "weekly" | "extra" | "balance" | "credits" | "design" | "status";

export const ALL_WIDGET_THEME_IDS: WidgetThemeId[] = [
  "rainmeter-stack",
  "orbit-gauges",
  "side-rail",
  "mono-ticker",
  "pinboard-mini",
  "terminal-deck",
];

export interface WidgetCardVisibilityMap extends Record<WidgetCardId, boolean> {}
export interface WidgetProviderCardVisibility extends Record<Provider, WidgetCardVisibilityMap> {}

export interface WidgetThemeHeaderDefinition {
  style: WidgetThemeHeaderStyle;
  badgeStyle: WidgetHeaderBadgeStyle;
  badgeSize: Record<WidgetDensity, number>;
}

export interface WidgetThemeCustomization {
  accentColor?: string;
  headerBadgeMode?: WidgetHeaderBadgeMode;
  resetDisplayMode?: WidgetResetDisplayMode;
}

export interface WidgetThemeCustomizationMap extends Partial<Record<WidgetThemeId, WidgetThemeCustomization>> {}

export interface WidgetOverlayLayout {
  version: number;
  position: { x: number; y: number };
  themeId: WidgetThemeId;
  density: WidgetDensity;
  scale: number;
  opacity: number;
  cardOrder: WidgetCardId[];
  cardVisibility: WidgetProviderCardVisibility;
  themeCustomizations: WidgetThemeCustomizationMap;
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
  secondaryCountdown?: string;
  secondaryBoth?: string;
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
  "design",
  "balance",
  "credits",
  "status",
];

export const DEFAULT_WIDGET_CARD_ORDER: WidgetCardId[] = [...ALL_WIDGET_CARD_IDS];
export const WIDGET_PROVIDER_CARD_IDS: Record<Provider, WidgetCardId[]> = {
  Claude: ["session", "weekly", "extra", "balance", "design", "status"],
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
    design: false,
    status: false,
  },
  Codex: {
    session: true,
    weekly: true,
    extra: false,
    balance: false,
    credits: true,
    design: false,
    status: false,
  },
  Cursor: {
    session: true,
    weekly: false,
    extra: false,
    balance: false,
    credits: false,
    design: false,
    status: false,
  },
};

export const DEFAULT_WIDGET_OVERLAY_LAYOUT: WidgetOverlayLayout = {
  version: 5,
  position: { x: 200, y: 100 },
  themeId: "rainmeter-stack",
  density: "ultra-compact",
  scale: 0.85,
  opacity: 1,
  cardOrder: DEFAULT_WIDGET_CARD_ORDER,
  cardVisibility: DEFAULT_CARD_VISIBILITY,
  themeCustomizations: {},
};
