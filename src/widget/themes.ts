import {
  ALL_WIDGET_THEME_IDS,
  type WidgetDensity,
  type WidgetThemeHeaderDefinition,
  type WidgetThemeId,
  type WidgetThemeLayoutFamily,
} from "../types/widget";

export interface WidgetThemeDefinition {
  id: WidgetThemeId;
  name: string;
  description: string;
  compactBehavior: string;
  bestForLaptop?: boolean;
  layoutFamily: WidgetThemeLayoutFamily;
  header: WidgetThemeHeaderDefinition;
  showSecondaryByDefault: boolean;
  useAbbreviatedLabels?: boolean;
  stackGap: Record<WidgetDensity, number>;
  cardMinWidth: Record<WidgetDensity, number>;
  cardMinHeight: Record<WidgetDensity, number>;
  cardPadding: Record<WidgetDensity, string>;
  cardRadius: string;
  cardSurface: string;
  cardBorder: string;
  cardShadow: string;
  cardBlur: string;
  iconBackground: string;
  iconSize: Record<WidgetDensity, number>;
  titleStyle: string;
  primarySize: Record<WidgetDensity, string>;
  secondaryStyle: Record<WidgetDensity, string>;
  progressTrack: string;
  gaugeThickness?: Record<WidgetDensity, number>;
  railThickness?: Record<WidgetDensity, number>;
  previewStyle: "slab" | "rail" | "mono" | "orbit" | "pinboard" | "terminal";
}

const density = <T,>(ultraCompact: T, compact: T, comfortable: T): Record<WidgetDensity, T> => ({
  "ultra-compact": ultraCompact,
  compact,
  comfortable,
});

const header = (
  style: WidgetThemeHeaderDefinition["style"],
  badgeStyle: WidgetThemeHeaderDefinition["badgeStyle"],
  ultraCompact: number,
  compact: number,
  comfortable: number,
): WidgetThemeHeaderDefinition => ({
  style,
  badgeStyle,
  badgeSize: density(ultraCompact, compact, comfortable),
});

export const WIDGET_THEMES: Record<WidgetThemeId, WidgetThemeDefinition> = {
  "rainmeter-stack": {
    id: "rainmeter-stack",
    name: "Rainmeter Stack",
    description: "Premium dark slabs with bright badges and the strongest everyday readability.",
    compactBehavior: "Ultra-compact strips to tight slabs with the helper line hidden first.",
    layoutFamily: "slab-stack",
    header: header("capsule", "glass", 14, 18, 24),
    showSecondaryByDefault: true,
    stackGap: density(2, 5, 12),
    cardMinWidth: density(130, 195, 300),
    cardMinHeight: density(36, 64, 110),
    cardPadding: density("3px 7px 3px", "8px 11px 8px", "16px 20px 16px"),
    cardRadius: "24px",
    cardSurface: "linear-gradient(180deg, rgb(19, 25, 38), rgb(9, 13, 22))",
    cardBorder: "1px solid rgba(255, 255, 255, 0.08)",
    cardShadow: "0 16px 36px rgba(0, 0, 0, 0.28)",
    cardBlur: "none",
    iconBackground: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05))",
    iconSize: density(12, 22, 48),
    titleStyle: "700 11px/1 'Aptos', 'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    primarySize: density(
      "600 11px/0.95 'Aptos Display', 'Segoe UI Variable Display', 'Segoe UI', sans-serif",
      "600 18px/0.95 'Aptos Display', 'Segoe UI Variable Display', 'Segoe UI', sans-serif",
      "600 31px/0.95 'Aptos Display', 'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.1 'Aptos', 'Segoe UI', sans-serif",
      "500 10px/1.25 'Aptos', 'Segoe UI', sans-serif",
      "500 12px/1.35 'Aptos', 'Segoe UI', sans-serif",
    ),
    progressTrack: "rgba(255,255,255,0.12)",
    previewStyle: "slab",
  },
  "orbit-gauges": {
    id: "orbit-gauges",
    name: "Orbit Gauges",
    description: "Circular car-style gauges with arc indicators and centered readouts.",
    compactBehavior: "Ultra-compact keeps the ring, value, and label while secondary detail becomes optional.",
    bestForLaptop: true,
    layoutFamily: "orbit-gauges",
    header: header("orbit", "solid", 14, 18, 22),
    showSecondaryByDefault: true,
    useAbbreviatedLabels: true,
    stackGap: density(3, 6, 12),
    cardMinWidth: density(92, 120, 156),
    cardMinHeight: density(108, 144, 186),
    cardPadding: density("6px 6px 7px", "9px 9px 10px", "14px 14px 15px"),
    cardRadius: "22px",
    cardSurface: "linear-gradient(180deg, rgb(10, 14, 24), rgb(5, 7, 15))",
    cardBorder: "1px solid rgba(158, 208, 255, 0.12)",
    cardShadow: "0 14px 28px rgba(0, 0, 0, 0.24)",
    cardBlur: "none",
    iconBackground: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
    iconSize: density(9, 12, 18),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 11px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 15px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 22px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "500 10px/1.2 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(255,255,255,0.09)",
    gaugeThickness: density(4, 6, 8),
    previewStyle: "orbit",
  },
  "side-rail": {
    id: "side-rail",
    name: "Side Rail",
    description: "Ultra-narrow telemetry strips meant to live on the edge of a laptop screen.",
    compactBehavior: "Ultra-compact becomes a hairline strip with value and meter only.",
    bestForLaptop: true,
    layoutFamily: "micro-rail",
    header: header("rail", "ghost", 13, 16, 20),
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    stackGap: density(2, 4, 10),
    cardMinWidth: density(120, 180, 280),
    cardMinHeight: density(26, 40, 72),
    cardPadding: density("2px 5px 2px", "4px 7px 4px", "8px 12px 9px"),
    cardRadius: "14px",
    cardSurface: "linear-gradient(180deg, rgb(12, 16, 21), rgb(7, 10, 14))",
    cardBorder: "1px solid rgba(255,255,255,0.05)",
    cardShadow: "0 6px 16px rgba(0,0,0,0.16)",
    cardBlur: "none",
    iconBackground: "rgba(255,255,255,0.04)",
    iconSize: density(8, 13, 20),
    titleStyle: "700 9px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 8px/1 'Aptos', 'Segoe UI', sans-serif",
      "700 12px/1 'Aptos', 'Segoe UI', sans-serif",
      "700 17px/1 'Aptos', 'Segoe UI', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.05 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "500 9px/1.1 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(255,255,255,0.1)",
    railThickness: density(2, 3, 6),
    previewStyle: "rail",
  },
  "mono-ticker": {
    id: "mono-ticker",
    name: "Mono Ticker",
    description: "A restrained monochrome readout with low-contrast meters and minimal visual noise.",
    compactBehavior: "Ultra-compact collapses to dense pill chips with value-first scanning.",
    bestForLaptop: true,
    layoutFamily: "micro-rail",
    header: header("ghost", "ghost", 12, 15, 18),
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    stackGap: density(2, 3, 8),
    cardMinWidth: density(110, 170, 280),
    cardMinHeight: density(24, 36, 66),
    cardPadding: density("2px 5px 2px", "4px 7px 4px", "8px 12px 8px"),
    cardRadius: "999px",
    cardSurface: "linear-gradient(180deg, rgb(20, 21, 24), rgb(10, 11, 14))",
    cardBorder: "1px solid rgba(255,255,255,0.04)",
    cardShadow: "none",
    cardBlur: "none",
    iconBackground: "rgba(255,255,255,0.025)",
    iconSize: density(8, 11, 16),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "600 8px/1 'Aptos', 'Segoe UI', sans-serif",
      "600 11px/1 'Aptos', 'Segoe UI', sans-serif",
      "600 15px/1 'Aptos', 'Segoe UI', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.05 'JetBrains Mono', ui-monospace, monospace",
      "500 9px/1.1 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(255,255,255,0.08)",
    railThickness: density(1, 2, 5),
    previewStyle: "mono",
  },
  "pinboard-mini": {
    id: "pinboard-mini",
    name: "Pinboard Mini",
    description: "Sharper HUD styling with denser information, stronger contrast, and crisp telemetry.",
    compactBehavior: "Ultra-compact keeps value and meter while helper copy trims back.",
    layoutFamily: "pinboard-mini",
    header: header("panel", "solid", 14, 18, 24),
    showSecondaryByDefault: true,
    useAbbreviatedLabels: true,
    stackGap: density(3, 6, 10),
    cardMinWidth: density(108, 140, 186),
    cardMinHeight: density(58, 78, 106),
    cardPadding: density("7px 8px 7px", "10px 11px 10px", "15px 16px 16px"),
    cardRadius: "18px",
    cardSurface: "linear-gradient(180deg, rgb(11, 17, 25), rgb(6, 10, 16))",
    cardBorder: "1px solid rgba(137, 207, 255, 0.15)",
    cardShadow: "0 12px 24px rgba(0, 0, 0, 0.18)",
    cardBlur: "none",
    iconBackground: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))",
    iconSize: density(11, 14, 20),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 10px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 14px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 19px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.2 'JetBrains Mono', ui-monospace, monospace",
      "500 10px/1.25 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(137, 207, 255, 0.12)",
    railThickness: density(2, 3, 5),
    previewStyle: "pinboard",
  },
  "terminal-deck": {
    id: "terminal-deck",
    name: "Terminal Deck",
    description: "Phosphor-green digital rain telemetry on a deep black field.",
    compactBehavior: "Ultra-compact keeps glyph, value, and bar while helper lines hide first.",
    bestForLaptop: true,
    layoutFamily: "terminal-deck",
    header: header("terminal", "terminal", 14, 17, 22),
    showSecondaryByDefault: true,
    useAbbreviatedLabels: true,
    stackGap: density(2, 4, 10),
    cardMinWidth: density(160, 208, 292),
    cardMinHeight: density(40, 58, 88),
    cardPadding: density("5px 7px 6px", "8px 10px 9px", "14px 16px 15px"),
    cardRadius: "8px",
    cardSurface: "linear-gradient(180deg, rgb(2, 8, 2), rgb(0, 4, 0))",
    cardBorder: "1px solid rgba(0, 255, 65, 0.12)",
    cardShadow: "0 0 18px rgba(0, 255, 65, 0.05)",
    cardBlur: "none",
    iconBackground: "rgba(0, 255, 65, 0.06)",
    iconSize: density(8, 11, 18),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 10px/1 'JetBrains Mono', ui-monospace, monospace",
      "700 13px/1 'JetBrains Mono', ui-monospace, monospace",
      "700 18px/1 'JetBrains Mono', ui-monospace, monospace",
    ),
    secondaryStyle: density(
      "500 7px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "500 10px/1.2 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(0, 255, 65, 0.08)",
    railThickness: density(2, 3, 5),
    previewStyle: "terminal",
  },
};

export const WIDGET_THEME_IDS = [...ALL_WIDGET_THEME_IDS];

export function getWidgetTheme(themeId: WidgetThemeId) {
  return WIDGET_THEMES[themeId];
}
