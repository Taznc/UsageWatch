import {
  ALL_WIDGET_THEME_IDS,
  type WidgetDensity,
  type WidgetThemeHeaderStyle,
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
  headerStyle: WidgetThemeHeaderStyle;
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
  previewStyle: "slab" | "tower" | "rail" | "mono" | "panel" | "matrix" | "dial";
}

const density = <T,>(ultraCompact: T, compact: T, comfortable: T): Record<WidgetDensity, T> => ({
  "ultra-compact": ultraCompact,
  compact,
  comfortable,
});

export const WIDGET_THEMES: Record<WidgetThemeId, WidgetThemeDefinition> = {
  "rainmeter-stack": {
    id: "rainmeter-stack",
    name: "Rainmeter Stack",
    description: "Premium dark slabs with bright badges and the strongest everyday readability.",
    compactBehavior: "Ultra-compact strips to tightest slabs — tiny badge, no subline, minimal padding.",
    layoutFamily: "slab-stack",
    headerStyle: "capsule",
    showSecondaryByDefault: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     5,         12),
    cardMinWidth: density(130,  195,        300),
    cardMinHeight: density(36,  64,         110),
    cardPadding: density("3px 7px 3px", "8px 11px 8px", "16px 20px 16px"),
    cardRadius: "24px",
    cardSurface: "linear-gradient(180deg, rgba(19, 25, 38, 0.86), rgba(9, 13, 22, 0.78))",
    cardBorder: "1px solid rgba(255, 255, 255, 0.08)",
    cardShadow: "0 16px 36px rgba(0, 0, 0, 0.28)",
    cardBlur: "blur(22px) saturate(1.12)",
    iconBackground: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05))",
    iconSize:    density(12,   22,          48),
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
  "gauge-tower": {
    id: "gauge-tower",
    name: "Gauge Dials",
    description: "Circular car-gauge dials with arc progress indicators and centered percentage readouts.",
    compactBehavior: "Ultra-compact shrinks dials to tiny rings — label and value only, no subtext.",
    bestForLaptop: true,
    layoutFamily: "dial-cluster",
    headerStyle: "dial",
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     5,         12),
    cardMinWidth: density(48,   70,         115),
    cardMinHeight: density(52,  84,         145),
    cardPadding: density("3px 2px 2px", "5px 4px 4px", "12px 10px 10px"),
    cardRadius: "16px",
    cardSurface: "linear-gradient(180deg, rgba(8, 12, 22, 0.86), rgba(4, 6, 14, 0.8))",
    cardBorder: "1px solid rgba(140, 200, 255, 0.1)",
    cardShadow: "0 8px 20px rgba(0,0,0,0.22)",
    cardBlur: "blur(16px) saturate(1.1)",
    iconBackground: "rgba(255,255,255,0.04)",
    iconSize:    density(8,    12,          20),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 9px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 14px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 22px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "500 10px/1.2 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(255,255,255,0.08)",
    gaugeThickness: density(3, 5, 8),
    previewStyle: "dial",
  },
  "side-rail": {
    id: "side-rail",
    name: "Side Rail",
    description: "Ultra-narrow telemetry strips meant to live on the side of a laptop screen.",
    compactBehavior: "Ultra-compact becomes a hairline strip — values and bar only, no labels or subtext.",
    bestForLaptop: true,
    layoutFamily: "micro-rail",
    headerStyle: "rail",
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     4,         10),
    cardMinWidth: density(120,  180,        280),
    cardMinHeight: density(26,  40,         72),
    cardPadding: density("2px 5px 2px", "4px 7px 4px", "8px 12px 9px"),
    cardRadius: "14px",
    cardSurface: "linear-gradient(180deg, rgba(12, 16, 21, 0.8), rgba(7, 10, 14, 0.75))",
    cardBorder: "1px solid rgba(255,255,255,0.05)",
    cardShadow: "0 6px 16px rgba(0,0,0,0.16)",
    cardBlur: "blur(14px) saturate(1.06)",
    iconBackground: "rgba(255,255,255,0.04)",
    iconSize:    density(8,    13,          20),
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
    compactBehavior: "Ultra-compact collapses to a dense row of pill chips — value and bar only.",
    bestForLaptop: true,
    layoutFamily: "micro-rail",
    headerStyle: "ghost",
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     3,         8),
    cardMinWidth: density(110,  170,        280),
    cardMinHeight: density(24,  36,         66),
    cardPadding: density("2px 5px 2px", "4px 7px 4px", "8px 12px 8px"),
    cardRadius: "999px",
    cardSurface: "linear-gradient(180deg, rgba(20, 21, 24, 0.62), rgba(10, 11, 14, 0.58))",
    cardBorder: "1px solid rgba(255,255,255,0.04)",
    cardShadow: "none",
    cardBlur: "blur(10px) saturate(1.01)",
    iconBackground: "rgba(255,255,255,0.025)",
    iconSize:    density(8,    11,          16),
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
  "signal-deck": {
    id: "signal-deck",
    name: "Signal Deck",
    description: "Sharper HUD panels with dense telemetry, harder edges, and brighter status accents.",
    compactBehavior: "Ultra-compact compresses panels to tight rows — meter and value, no labels or secondary.",
    layoutFamily: "telemetry-panel",
    headerStyle: "panel",
    showSecondaryByDefault: true,
    useAbbreviatedLabels: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     5,         10),
    cardMinWidth: density(140,  200,        300),
    cardMinHeight: density(34,  55,         90),
    cardPadding: density("4px 6px 4px", "6px 9px 6px", "14px 16px 15px"),
    cardRadius: "12px",
    cardSurface: "linear-gradient(180deg, rgba(8, 13, 21, 0.88), rgba(5, 8, 14, 0.82))",
    cardBorder: "1px solid rgba(111, 221, 255, 0.2)",
    cardShadow: "0 10px 24px rgba(0,0,0,0.18)",
    cardBlur: "blur(16px) saturate(1.18)",
    iconBackground: "rgba(111,221,255,0.07)",
    iconSize:    density(9,    15,          24),
    titleStyle: "700 9px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 9px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 14px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
      "700 21px/1 'Aptos Display', 'Segoe UI Variable Display', sans-serif",
    ),
    secondaryStyle: density(
      "500 7px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "500 8px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "500 10px/1.2 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(111,221,255,0.12)",
    railThickness: density(2, 4, 7),
    previewStyle: "panel",
  },
  "matrix-rain": {
    id: "matrix-rain",
    name: "Matrix",
    description: "Digital rain telemetry with phosphor-green readouts on a deep black field.",
    compactBehavior: "Ultra-compact collapses to hairline glyph strips — value and bar, maximum density.",
    layoutFamily: "matrix-rain",
    headerStyle: "matrix",
    showSecondaryByDefault: false,
    useAbbreviatedLabels: true,
    //           ultra-compact  compact    comfortable
    stackGap:    density(2,     5,         10),
    cardMinWidth: density(140,  200,        300),
    cardMinHeight: density(34,  54,         90),
    cardPadding: density("3px 7px 3px", "6px 9px 6px", "12px 16px 12px"),
    cardRadius: "4px",
    cardSurface: "linear-gradient(180deg, rgba(0, 8, 0, 0.88), rgba(0, 4, 0, 0.82))",
    cardBorder: "1px solid rgba(0, 255, 65, 0.12)",
    cardShadow: "0 0 20px rgba(0, 255, 65, 0.06)",
    cardBlur: "blur(8px)",
    iconBackground: "rgba(0, 255, 65, 0.06)",
    iconSize:    density(9,    14,          22),
    titleStyle: "700 8px/1 'JetBrains Mono', ui-monospace, monospace",
    primarySize: density(
      "700 11px/1 'JetBrains Mono', ui-monospace, monospace",
      "700 15px/1 'JetBrains Mono', ui-monospace, monospace",
      "700 22px/1 'JetBrains Mono', ui-monospace, monospace",
    ),
    secondaryStyle: density(
      "400 7px/1.1 'JetBrains Mono', ui-monospace, monospace",
      "400 8px/1.15 'JetBrains Mono', ui-monospace, monospace",
      "400 10px/1.2 'JetBrains Mono', ui-monospace, monospace",
    ),
    progressTrack: "rgba(0, 255, 65, 0.08)",
    railThickness: density(2, 3, 6),
    previewStyle: "panel",
  },
};

export const WIDGET_THEME_IDS = [...ALL_WIDGET_THEME_IDS];

export function getWidgetTheme(themeId: WidgetThemeId) {
  return WIDGET_THEMES[themeId];
}
