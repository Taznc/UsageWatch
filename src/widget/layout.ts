import type { Provider } from "../types/usage";
import {
  ALL_WIDGET_CARD_IDS,
  ALL_WIDGET_THEME_IDS,
  DEFAULT_WIDGET_OVERLAY_LAYOUT,
  type WidgetCardId,
  type WidgetCardVisibilityMap,
  type WidgetOverlayLayout,
  type WidgetProviderCardVisibility,
  type WidgetThemeCustomization,
  type WidgetThemeCustomizationMap,
  type WidgetThemeId,
} from "../types/widget";

export const WIDGET_LAYOUT_STORE_KEY = "widget_layout";

function cloneDefaultLayout(): WidgetOverlayLayout {
  return {
    ...DEFAULT_WIDGET_OVERLAY_LAYOUT,
    position: { ...DEFAULT_WIDGET_OVERLAY_LAYOUT.position },
    cardOrder: [...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardOrder],
    cardVisibility: {
      Claude: { ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Claude },
      Codex: { ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Codex },
      Cursor: { ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Cursor },
    },
    themeCustomizations: { ...DEFAULT_WIDGET_OVERLAY_LAYOUT.themeCustomizations },
  };
}

type LegacyProviderPreferences = {
  showExtra?: boolean;
  showBalance?: boolean;
  showCredits?: boolean;
  showStatus?: boolean;
};

type LegacyWidgetLayout = {
  version?: unknown;
  position?: { x?: unknown; y?: unknown };
  preferences?: {
    density?: unknown;
    claude?: LegacyProviderPreferences;
    codex?: LegacyProviderPreferences;
    cursor?: LegacyProviderPreferences;
  };
};

function normalizeDensity(density: unknown) {
  if (density === "ultra-compact") return "ultra-compact";
  if (density === "compact") return "compact";
  if (density === "comfortable") return "comfortable";
  return DEFAULT_WIDGET_OVERLAY_LAYOUT.density;
}

function normalizeScale(scale: unknown) {
  if (typeof scale !== "number" || Number.isNaN(scale)) {
    return DEFAULT_WIDGET_OVERLAY_LAYOUT.scale;
  }
  return Math.max(0.5, Math.min(1.15, Number(scale.toFixed(2))));
}

function normalizeOpacity(opacity: unknown) {
  if (typeof opacity !== "number" || Number.isNaN(opacity)) {
    return DEFAULT_WIDGET_OVERLAY_LAYOUT.opacity;
  }
  return Math.max(0.1, Math.min(1, Number(opacity.toFixed(2))));
}

function normalizePosition(saved: { x?: unknown; y?: unknown } | undefined) {
  return {
    x: typeof saved?.x === "number" ? saved.x : DEFAULT_WIDGET_OVERLAY_LAYOUT.position.x,
    y: typeof saved?.y === "number" ? saved.y : DEFAULT_WIDGET_OVERLAY_LAYOUT.position.y,
  };
}

function normalizeCardOrder(cardOrder: unknown): WidgetCardId[] {
  if (!Array.isArray(cardOrder)) return [...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardOrder];
  const deduped = cardOrder.filter((id): id is WidgetCardId => ALL_WIDGET_CARD_IDS.includes(id as WidgetCardId));
  const merged = [...deduped];
  for (const id of ALL_WIDGET_CARD_IDS) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

function mergeVisibility(
  base: WidgetCardVisibilityMap,
  candidate: unknown,
): WidgetCardVisibilityMap {
  const next = { ...base };
  if (!candidate || typeof candidate !== "object") return next;
  for (const cardId of ALL_WIDGET_CARD_IDS) {
    const value = (candidate as Record<string, unknown>)[cardId];
    if (typeof value === "boolean") {
      next[cardId] = value;
    }
  }
  return next;
}

function normalizeThemeId(themeId: unknown): WidgetThemeId {
  const normalized = resolveThemeId(themeId);
  return normalized ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.themeId;
}

function resolveThemeId(themeId: unknown): WidgetThemeId | null {
  if (themeId === "gauge-tower" || themeId === "minimal-air" || themeId === "micro-pillars") {
    return "orbit-gauges";
  }
  if (themeId === "rail-compact") return "side-rail";
  if (themeId === "mono-meter") return "mono-ticker";
  if (
    themeId === "signal-deck" ||
    themeId === "glass-column" ||
    themeId === "glass-orbit" ||
    themeId === "signal-panel"
  ) {
    return "pinboard-mini";
  }
  if (themeId === "matrix-rain") return "terminal-deck";
  return ALL_WIDGET_THEME_IDS.includes(themeId as WidgetThemeId) ? (themeId as WidgetThemeId) : null;
}

function normalizeThemeCustomization(candidate: unknown): WidgetThemeCustomization | null {
  if (!candidate || typeof candidate !== "object") return null;

  const raw = candidate as Record<string, unknown>;
  const next: WidgetThemeCustomization = {};

  if (typeof raw.accentColor === "string" && raw.accentColor.trim()) {
    next.accentColor = raw.accentColor;
  }

  if (raw.headerBadgeMode === "brand" || raw.headerBadgeMode === "mono") {
    next.headerBadgeMode = raw.headerBadgeMode;
  }

  if (raw.resetDisplayMode === "time" || raw.resetDisplayMode === "countdown" || raw.resetDisplayMode === "both") {
    next.resetDisplayMode = raw.resetDisplayMode;
  }

  return Object.keys(next).length ? next : null;
}

function normalizeThemeCustomizations(
  saved: unknown,
  legacyOverrides?: unknown,
): WidgetThemeCustomizationMap {
  const source =
    saved && typeof saved === "object"
      ? (saved as Record<string, unknown>)
      : legacyOverrides && typeof legacyOverrides === "object"
        ? (legacyOverrides as Record<string, unknown>)
        : null;

  if (!source) return {};

  const next: WidgetThemeCustomizationMap = {};
  for (const [rawThemeId, value] of Object.entries(source)) {
    const themeId = resolveThemeId(rawThemeId);
    if (!themeId) continue;
    const customization = normalizeThemeCustomization(value);
    if (customization) {
      next[themeId] = {
        ...next[themeId],
        ...customization,
      };
    }
  }
  return next;
}

function migrateLegacyVisibility(saved: LegacyWidgetLayout["preferences"]): WidgetProviderCardVisibility {
  return {
    Claude: {
      ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Claude,
      extra: saved?.claude?.showExtra ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Claude.extra,
      balance: saved?.claude?.showBalance ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Claude.balance,
      status: saved?.claude?.showStatus ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Claude.status,
    },
    Codex: {
      ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Codex,
      credits: saved?.codex?.showCredits ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Codex.credits,
      status: saved?.codex?.showStatus ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Codex.status,
    },
    Cursor: {
      ...DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Cursor,
      status: saved?.cursor?.showStatus ?? DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility.Cursor.status,
    },
  };
}

function normalizeVisibility(saved: unknown): WidgetProviderCardVisibility {
  const base = DEFAULT_WIDGET_OVERLAY_LAYOUT.cardVisibility;
  if (!saved || typeof saved !== "object") {
    return {
      Claude: { ...base.Claude },
      Codex: { ...base.Codex },
      Cursor: { ...base.Cursor },
    };
  }

  const candidate = saved as Record<Provider, unknown>;
  return {
    Claude: mergeVisibility(base.Claude, candidate.Claude),
    Codex: mergeVisibility(base.Codex, candidate.Codex),
    Cursor: mergeVisibility(base.Cursor, candidate.Cursor),
  };
}

export function normalizeWidgetOverlayLayout(saved: unknown): WidgetOverlayLayout {
  if (!saved || typeof saved !== "object") {
    return cloneDefaultLayout();
  }

  const candidate = saved as Record<string, unknown>;
  const version = typeof candidate.version === "number" ? candidate.version : 1;

  if (version < 2) {
    const legacy = candidate as LegacyWidgetLayout;
    return {
      ...cloneDefaultLayout(),
      version: 5,
      position: normalizePosition(legacy.position),
      density: normalizeDensity(legacy.preferences?.density),
      scale: DEFAULT_WIDGET_OVERLAY_LAYOUT.scale,
      opacity: DEFAULT_WIDGET_OVERLAY_LAYOUT.opacity,
      cardVisibility: migrateLegacyVisibility(legacy.preferences),
    };
  }

  return {
    version: 5,
    position: normalizePosition(candidate.position as { x?: unknown; y?: unknown } | undefined),
    density: normalizeDensity(candidate.density),
    scale: normalizeScale(candidate.scale),
    opacity: normalizeOpacity(candidate.opacity),
    themeId: normalizeThemeId(candidate.themeId),
    cardOrder: normalizeCardOrder(candidate.cardOrder),
    cardVisibility: normalizeVisibility(candidate.cardVisibility),
    themeCustomizations: normalizeThemeCustomizations(
      candidate.themeCustomizations,
      candidate.themeOverrides,
    ),
  };
}
