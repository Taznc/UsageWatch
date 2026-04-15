import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { SettingRow } from "../shared/SettingRow";
import { SettingGroup } from "../shared/SettingGroup";
import { WidgetCardConfigurator } from "../../WidgetCardConfigurator";
import {
  DEFAULT_WIDGET_OVERLAY_LAYOUT,
  ALL_WIDGET_THEME_IDS,
  type WidgetCardId,
  type WidgetDensity,
  type WidgetHeaderBadgeMode,
  type WidgetOverlayLayout,
  type WidgetResetDisplayMode,
  type WidgetThemeCustomization,
} from "../../../types/widget";
import { normalizeWidgetOverlayLayout, WIDGET_LAYOUT_STORE_KEY } from "../../../widget/layout";
import type { Provider } from "../../../types/usage";

const WIDGET_THEME_CATALOG: Record<
  (typeof ALL_WIDGET_THEME_IDS)[number],
  { name: string; bestForLaptop?: boolean }
> = {
  "rainmeter-stack": { name: "Rainmeter Stack" },
  "orbit-gauges": { name: "Orbit Gauges", bestForLaptop: true },
  "side-rail": { name: "Side Rail", bestForLaptop: true },
  "mono-ticker": { name: "Mono Ticker", bestForLaptop: true },
  "pinboard-mini": { name: "Pinboard Mini", bestForLaptop: true },
  "terminal-deck": { name: "Terminal Deck", bestForLaptop: true },
};

export function WidgetSection() {
  const [layout, setLayout] = useState<WidgetOverlayLayout>(DEFAULT_WIDGET_OVERLAY_LAYOUT);

  useEffect(() => {
    load("credentials.json", { autoSave: false, defaults: {} })
      .then((store) => store.get(WIDGET_LAYOUT_STORE_KEY))
      .then((raw) => setLayout(normalizeWidgetOverlayLayout(raw)))
      .catch(() => {});
  }, []);

  const updateLayout = async (updates: Partial<WidgetOverlayLayout>) => {
    const next: WidgetOverlayLayout = { ...layout, ...updates };
    setLayout(next);
    try {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      await store.set(WIDGET_LAYOUT_STORE_KEY, next);
      await store.save();
      await emit("widget-layout-updated", next);
    } catch {}
  };

  const updateCardVisibility = async (provider: Provider, cardId: WidgetCardId, value: boolean) => {
    await updateLayout({
      cardVisibility: {
        ...layout.cardVisibility,
        [provider]: { ...layout.cardVisibility[provider], [cardId]: value },
      },
    });
  };

  const reorderCards = async (newOrder: WidgetCardId[]) => {
    await updateLayout({ cardOrder: newOrder });
  };

  const terminalAccentColor =
    layout.themeCustomizations["terminal-deck"]?.accentColor || "#00ff41";
  const headerBadgeMode: WidgetHeaderBadgeMode =
    layout.themeCustomizations[layout.themeId]?.headerBadgeMode ?? "brand";
  const resetDisplayMode: WidgetResetDisplayMode =
    layout.themeCustomizations[layout.themeId]?.resetDisplayMode ?? "time";

  const updateThemeCustomization = async (
    updates: Partial<WidgetThemeCustomization>,
  ) => {
    const current = layout.themeCustomizations[layout.themeId] ?? {};
    const nextThemeCustomizations = {
      ...layout.themeCustomizations,
      [layout.themeId]: {
        ...current,
        ...updates,
      },
    };

    if (!Object.keys(nextThemeCustomizations[layout.themeId] ?? {}).length) {
      delete nextThemeCustomizations[layout.themeId];
    }

    await updateLayout({ themeCustomizations: nextThemeCustomizations });
  };

  return (
    <div>
      <div className="s-section-block">
        <span className="s-label">Theme</span>
        <div className="s-group">
          <div className="s-theme-grid">
            {ALL_WIDGET_THEME_IDS.map((themeId) => {
              const theme = WIDGET_THEME_CATALOG[themeId];
              const selected = layout.themeId === themeId;
              return (
                <button
                  key={themeId}
                  type="button"
                  className={`s-theme-chip${selected ? " selected" : ""}`}
                  onClick={() => updateLayout({ themeId })}
                  aria-pressed={selected}
                >
                  <span>{theme.name}</span>
                  {theme.bestForLaptop && <span className="s-theme-badge">S</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <SettingGroup label="Layout">
        <SettingRow label="Density">
          <select
            className="s-select"
            value={layout.density}
            onChange={(e) => updateLayout({ density: e.target.value as WidgetDensity })}
          >
            <option value="ultra-compact">Ultra compact</option>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </SettingRow>

        <div className="s-row s-row--col">
          <div className="s-row-left" style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="s-row-label">Scale</span>
              <span className="s-slider-value">{Math.round(layout.scale * 100)}%</span>
            </div>
            <div className="s-row-hint">Resize the whole widget after density is applied</div>
          </div>
          <input
            type="range" min={50} max={115} step={5}
            value={Math.round(layout.scale * 100)}
            onChange={(e) => updateLayout({ scale: Number(e.target.value) / 100 })}
            className="s-slider"
          />
          <div className="s-slider-row"><span>50%</span><span>115%</span></div>
        </div>
      </SettingGroup>

      <SettingGroup label="Header">
        <SettingRow label="Provider badge">
          <select
            className="s-select"
            value={headerBadgeMode}
            onChange={(e) =>
              updateThemeCustomization({
                headerBadgeMode: e.target.value as WidgetHeaderBadgeMode,
              })
            }
          >
            <option value="brand">Styled brand badge</option>
            <option value="mono">Monochrome badge</option>
          </select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Details">
        <SettingRow label="Reset detail">
          <select
            className="s-select"
            value={resetDisplayMode}
            onChange={(e) =>
              updateThemeCustomization({
                resetDisplayMode: e.target.value as WidgetResetDisplayMode,
              })
            }
          >
            <option value="time">Scheduled time</option>
            <option value="countdown">Countdown</option>
            <option value="both">Time + countdown</option>
          </select>
        </SettingRow>
      </SettingGroup>

      {layout.themeId === "terminal-deck" && (
        <SettingGroup label="Terminal theme">
          <SettingRow label="Accent color">
            <div className="s-color-row">
              <input
                type="color"
                className="s-color-input"
                value={terminalAccentColor}
                onChange={(e) =>
                  updateThemeCustomization({ accentColor: e.target.value })
                }
              />
              <span className="s-color-label">{terminalAccentColor.toUpperCase()}</span>
              {layout.themeCustomizations["terminal-deck"]?.accentColor && (
                <button
                  className="s-btn-sm"
                  onClick={() => {
                    const current = layout.themeCustomizations["terminal-deck"];
                    if (!current) return;
                    const { accentColor: _removed, ...rest } = current;
                    const nextThemeCustomizations = { ...layout.themeCustomizations };
                    if (Object.keys(rest).length) {
                      nextThemeCustomizations["terminal-deck"] = rest;
                    } else {
                      delete nextThemeCustomizations["terminal-deck"];
                    }
                    updateLayout({ themeCustomizations: nextThemeCustomizations });
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </SettingRow>
        </SettingGroup>
      )}

      <SettingGroup label="Cards">
        <div style={{ padding: "8px 12px" }}>
          <WidgetCardConfigurator
            cardOrder={layout.cardOrder}
            cardVisibility={layout.cardVisibility}
            onReorder={reorderCards}
            onVisibilityChange={updateCardVisibility}
          />
        </div>
      </SettingGroup>
    </div>
  );
}
