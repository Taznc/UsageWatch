import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { useApp } from "../context/AppContext";
import { formatPollInterval } from "../utils/format";
import { DebugPanel } from "./DebugPanel";
import { ProviderMethodPicker } from "./setup/ProviderMethodPicker";
import type { TrayFormat, TrayConfig, TraySegmentDef, TrayField, RunningApp, Provider, AlertConfig, AppMapping } from "../types/usage";
import {
  DEFAULT_WIDGET_OVERLAY_LAYOUT,
  ALL_WIDGET_THEME_IDS,
  type WidgetCardId,
  type WidgetDensity,
  type WidgetOverlayLayout,
} from "../types/widget";
import { normalizeWidgetOverlayLayout, WIDGET_LAYOUT_STORE_KEY } from "../widget/layout";
import { WidgetCardConfigurator } from "./WidgetCardConfigurator";

type NavId = "account" | "menu-bar" | "provider" | "widget" | "alerts" | "general" | "debug";

type NavItem = { id: NavId; label: string; sub: string };

const isMacPlatform = /mac/i.test(navigator.userAgent);
const statusDisplayLabel = isMacPlatform ? "Menu Bar" : "Tooltip";
const statusDisplayTarget = isMacPlatform ? "menu bar" : "tooltip";


const WIDGET_THEME_CATALOG: Record<
  (typeof ALL_WIDGET_THEME_IDS)[number],
  {
    name: string;
    description: string;
    layoutFamily: string;
    bestForLaptop?: boolean;
  }
> = {
  "rainmeter-stack": {
    name: "Rainmeter Stack",
    description: "Premium glass slabs with strong readability and a familiar desktop-widget silhouette.",
    layoutFamily: "slab-stack",
  },
  "gauge-tower": {
    name: "Gauge Dials",
    description: "Circular car-style gauges with arc indicators and centered readouts.",
    layoutFamily: "dial-cluster",
    bestForLaptop: true,
  },
  "side-rail": {
    name: "Side Rail",
    description: "Ultra-narrow telemetry rails that save width and keep labels abbreviated.",
    layoutFamily: "micro-rail",
    bestForLaptop: true,
  },
  "mono-ticker": {
    name: "Mono Ticker",
    description: "Quiet monochrome micro-widget with minimal noise and a tiny footprint.",
    layoutFamily: "micro-rail",
    bestForLaptop: true,
  },
  "signal-deck": {
    name: "Signal Deck",
    description: "Sharper HUD styling with denser information, stronger contrast, and crisp telemetry.",
    layoutFamily: "telemetry-panel",
  },
  "matrix-rain": {
    name: "Matrix",
    description: "Phosphor-green digital rain telemetry on a deep black field.",
    layoutFamily: "matrix-rain",
    bestForLaptop: true,
  },
};

const IS_DEV = import.meta.env.DEV;

const NAV_ITEMS: NavItem[] = [
  { id: "account",   label: "Account",   sub: "Session key & org" },
  { id: "menu-bar",  label: statusDisplayLabel, sub: isMacPlatform ? "Tray display" : "Tray icon details" },
  { id: "provider",  label: "Provider",  sub: "Focus-based switching" },
  { id: "widget",    label: "Widget",    sub: "Themes & layout" },
  { id: "alerts",    label: "Alerts",    sub: "Notifications" },
  { id: "general",   label: "General",   sub: "Polling & startup" },
  ...(IS_DEV ? [{ id: "debug" as const, label: "Debug", sub: "Diagnostics" }] : []),
];

function normalizePickedMapping(path: string): string {
  const normalized = path.split(/[/\\]/).pop()?.trim() ?? path.trim();
  return normalized.replace(/\.app$/i, "").replace(/\.exe$/i, "").replace(/\.lnk$/i, "");
}

// ── Multi-provider segment helpers ──────────────────────────────────────────

const PROVIDER_EMOJI: Record<Provider, string> = { Claude: "\u{1F7E0}", Codex: "\u{1F7E2}", Cursor: "\u{1F7E3}" };

const TRAY_FIELD_OPTIONS: { value: TrayField; label: string; providerOnly?: Provider }[] = [
  { value: "SessionPct",   label: "Session %" },
  { value: "SessionTimer", label: "Session countdown" },
  { value: "WeeklyPct",    label: "Weekly %" },
  { value: "WeeklyTimer",  label: "Weekly countdown" },
  { value: "SonnetPct",    label: "Sonnet %",  providerOnly: "Claude" },
  { value: "OpusPct",      label: "Opus %",    providerOnly: "Claude" },
  { value: "ExtraUsage",   label: "Extra usage spend" },
];

function isStaticOrMulti(mode: TrayConfig["mode"]): boolean {
  if (typeof mode === "object") return "Static" in mode || "Multi" in mode;
  return false;
}

function getMultiSegments(config: TrayConfig): TraySegmentDef[] {
  const { mode } = config;
  if (typeof mode === "object" && "Multi" in mode) return mode.Multi;
  if (typeof mode === "object" && "Static" in mode) {
    const p = mode.Static;
    return [
      { kind: { type: "ProviderData", provider: p, field: "SessionPct" } },
      { kind: { type: "ProviderData", provider: p, field: "SessionTimer" } },
    ];
  }
  return [];
}

function segmentPreview(seg: TraySegmentDef): string {
  const k = seg.kind;
  if (k.type === "CustomText") return `"${k.text}"`;
  const field = TRAY_FIELD_OPTIONS.find(f => f.value === k.field);
  return `${PROVIDER_EMOJI[k.provider]} ${field?.label ?? k.field}`;
}

function SegmentBuilder({
  segments,
  separator,
  onUpdate,
}: {
  segments: TraySegmentDef[];
  separator: string;
  onUpdate: (segs: TraySegmentDef[]) => void;
}) {
  const [addKind, setAddKind] = useState<"ProviderData" | "CustomText">("ProviderData");
  const [addProvider, setAddProvider] = useState<Provider>("Claude");
  const [addField, setAddField] = useState<TrayField>("SessionPct");
  const [addText, setAddText] = useState("");

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...segments];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onUpdate(next);
  };
  const moveDown = (i: number) => {
    if (i >= segments.length - 1) return;
    const next = [...segments];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onUpdate(next);
  };
  const remove = (i: number) => onUpdate(segments.filter((_, idx) => idx !== i));
  const addSegment = () => {
    if (addKind === "CustomText") {
      if (!addText.trim()) return;
      onUpdate([...segments, { kind: { type: "CustomText", text: addText.trim() } }]);
      setAddText("");
    } else {
      onUpdate([...segments, { kind: { type: "ProviderData", provider: addProvider, field: addField } }]);
    }
  };

  const fieldsForProvider = TRAY_FIELD_OPTIONS.filter(
    f => !f.providerOnly || f.providerOnly === addProvider
  );

  return (
    <div className="settings-card" style={{ marginTop: 12 }}>
      <p className="card-label">Tray segments</p>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Compose your {isMacPlatform ? "menu bar" : "tooltip"} from any combination of providers and custom text.
      </p>

      {/* Live preview */}
      <div className="tray-preview" style={{ marginBottom: 8 }}>
        {segments.length > 0
          ? segments.map((s, i) => (
              <span key={i}>
                {i > 0 && <span style={{ opacity: 0.4 }}>{separator}</span>}
                {segmentPreview(s)}
              </span>
            ))
          : "--"}
      </div>

      {/* Segment list */}
      {segments.map((seg, i) => (
        <div
          key={i}
          className="mapping-row"
          style={{ gap: 4, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}
        >
          <span style={{ flex: 1, fontSize: 12 }}>{segmentPreview(seg)}</span>
          <button className="icon-btn" onClick={() => moveUp(i)} disabled={i === 0} title="Move up" style={{ fontSize: 14 }}>&#9650;</button>
          <button className="icon-btn" onClick={() => moveDown(i)} disabled={i === segments.length - 1} title="Move down" style={{ fontSize: 14 }}>&#9660;</button>
          <button className="icon-btn mapping-remove" onClick={() => remove(i)} title="Remove">&#215;</button>
        </div>
      ))}

      {/* Add segment controls */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input" value={addKind} onChange={(e) => setAddKind(e.target.value as "ProviderData" | "CustomText")} style={{ width: "auto" }}>
            <option value="ProviderData">Provider data</option>
            <option value="CustomText">Custom text</option>
          </select>

          {addKind === "ProviderData" && (
            <>
              <select className="input" value={addProvider} onChange={(e) => { setAddProvider(e.target.value as Provider); setAddField("SessionPct"); }} style={{ width: "auto" }}>
                <option value="Claude">{PROVIDER_EMOJI.Claude} Claude</option>
                <option value="Codex">{PROVIDER_EMOJI.Codex} Codex</option>
                <option value="Cursor">{PROVIDER_EMOJI.Cursor} Cursor</option>
              </select>
              <select className="input" value={addField} onChange={(e) => setAddField(e.target.value as TrayField)} style={{ width: "auto" }}>
                {fieldsForProvider.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </>
          )}

          {addKind === "CustomText" && (
            <input
              className="input"
              style={{ flex: 1, minWidth: 80 }}
              placeholder="Enter custom text"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSegment(); }}
            />
          )}

          <button className="icon-btn" style={{ fontSize: 18, fontWeight: 600 }} onClick={addSegment} title="Add segment">+</button>
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { state, dispatch } = useApp();
  const { settings } = state;

  const [activeTab, setActiveTab] = useState<NavId>("account");
  const [trayFormat, setTrayFormat] = useState<TrayFormat>({
    show_session_pct: true,
    show_weekly_pct: true,
    show_sonnet_pct: false,
    show_opus_pct: false,
    show_session_timer: true,
    show_weekly_timer: false,
    show_extra_usage: false,
    separator: " | ",
  });
  const [trayConfig, setTrayConfig] = useState<TrayConfig>({
    mode: "Dynamic",
    app_mappings: [
      { app_identifier: "com.anthropic.claudefordesktop", provider: "Claude" },
      { app_identifier: "com.openai.codex", provider: "Codex" },
      { app_identifier: "Cursor.exe", provider: "Cursor" },
    ],
    default_provider: "Claude",
    title_matching_enabled: false,
  });
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [editingTitleIdx, setEditingTitleIdx] = useState<number | null>(null);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [newMappingApp, setNewMappingApp] = useState("");
  const [newMappingProvider, setNewMappingProvider] = useState<Provider>("Claude");
  const [mappingPlatform, setMappingPlatform] = useState<"mac" | "windows">(isMacPlatform ? "mac" : "windows");
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [widgetLayout, setWidgetLayout] = useState<WidgetOverlayLayout>(DEFAULT_WIDGET_OVERLAY_LAYOUT);

  // ── Alert config state ────────────────────────────────────────────────────
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    enabled: true,
    session_threshold: 80,
    weekly_threshold: 80,
    burn_rate_mins: 30,
    notify_on_reset: true,
  });

  useEffect(() => {
    async function loadTrayFormat() {
      try {
        const fmt = await invoke<TrayFormat>("get_tray_format");
        setTrayFormat(fmt);
      } catch {}
    }
    async function loadTrayConfig() {
      try {
        const cfg = await invoke<TrayConfig>("get_tray_config");
        setTrayConfig(cfg);
      } catch {}
    }
    async function loadAlertConfig() {
      try {
        const cfg = await invoke<AlertConfig>("get_alert_config");
        setAlertConfig(cfg);
      } catch {}
    }
    async function loadWidgetLayout() {
      try {
        const store = await load("credentials.json", { autoSave: false, defaults: {} });
        setWidgetLayout(normalizeWidgetOverlayLayout(await store.get(WIDGET_LAYOUT_STORE_KEY)));
      } catch {}
    }
    loadTrayFormat();
    loadTrayConfig();
    loadAlertConfig();
    loadWidgetLayout();
    if (isMacPlatform) checkAccessibility();
  }, []);

  const updateTrayFormat = async (updates: Partial<TrayFormat>) => {
    const newFormat = { ...trayFormat, ...updates };
    setTrayFormat(newFormat);
    try {
      await invoke("set_tray_format", { format: newFormat });
    } catch {}
  };

  const updateTrayConfig = async (updates: Partial<TrayConfig>) => {
    const newConfig = { ...trayConfig, ...updates };
    setTrayConfig(newConfig);
    try {
      await invoke("set_tray_config", { config: newConfig });
    } catch {}
  };

  const updateAlertConfig = async (updates: Partial<AlertConfig>) => {
    const newConfig = { ...alertConfig, ...updates };
    setAlertConfig(newConfig);
    try {
      await invoke("set_alert_config", { config: newConfig });
    } catch {}
  };

  const updateWidgetLayout = async (updates: Partial<WidgetOverlayLayout>) => {
    const next: WidgetOverlayLayout = {
      ...widgetLayout,
      ...updates,
    };
    setWidgetLayout(next);
    try {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      await store.set(WIDGET_LAYOUT_STORE_KEY, next);
      await store.save();
      await emit("widget-layout-updated", next);
    } catch {}
  };

  const updateCardVisibility = async (provider: Provider, cardId: WidgetCardId, value: boolean) => {
    await updateWidgetLayout({
      cardVisibility: {
        ...widgetLayout.cardVisibility,
        [provider]: {
          ...widgetLayout.cardVisibility[provider],
          [cardId]: value,
        },
      },
    });
  };

  const reorderCards = async (newOrder: WidgetCardId[]) => {
    await updateWidgetLayout({ cardOrder: newOrder });
  };

  const loadRunningApps = async () => {
    try {
      const apps = await invoke<RunningApp[]>("get_running_apps");
      setRunningApps(apps.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {}
  };

  const checkAccessibility = async () => {
    try {
      const granted = await invoke<boolean>("check_accessibility_permission");
      setAccessibilityGranted(granted);
    } catch {}
  };

  const requestAccessibility = async () => {
    try {
      await invoke<boolean>("request_accessibility_permission");
      // Poll for a few seconds after prompting since the user has to switch to System Settings
      let attempts = 0;
      const poll = setInterval(async () => {
        const granted = await invoke<boolean>("check_accessibility_permission");
        setAccessibilityGranted(granted);
        if (granted || ++attempts >= 10) clearInterval(poll);
      }, 1500);
    } catch {}
  };

  const toggleTitleMatching = async (enabled: boolean) => {
    try {
      await invoke("set_title_matching_enabled", { enabled });
      updateTrayConfig({ title_matching_enabled: enabled });
    } catch {}
  };

  const pickMappingTarget = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: isMacPlatform ? "Pick an app" : "Pick an app or executable",
        filters: isMacPlatform
          ? [{ name: "Applications", extensions: ["app"] }]
          : [
              { name: "Executables", extensions: ["exe", "lnk"] },
              { name: "Applications", extensions: ["exe", "lnk", "app"] },
            ],
      });

      if (typeof selected === "string" && selected.trim()) {
        setNewMappingApp(normalizePickedMapping(selected));
      }
    } catch {
      // User cancellation is non-critical.
    }
  };

  const buildPreview = (): string => {
    const parts: string[] = [];
    if (trayFormat.show_session_pct || trayFormat.show_session_timer) {
      const sub: string[] = [];
      if (trayFormat.show_session_pct) sub.push("S:42%");
      if (trayFormat.show_session_timer) sub.push("2h9m");
      parts.push(sub.join(" "));
    }
    if (trayFormat.show_weekly_pct || trayFormat.show_weekly_timer) {
      const sub: string[] = [];
      if (trayFormat.show_weekly_pct) sub.push("W:85%");
      if (trayFormat.show_weekly_timer) sub.push("3d15h");
      parts.push(sub.join(" "));
    }
    if (trayFormat.show_sonnet_pct) parts.push("So:8%");
    if (trayFormat.show_opus_pct) parts.push("Op:15%");
    if (trayFormat.show_extra_usage) parts.push("$5/$20");
    return parts.length > 0 ? parts.join(trayFormat.separator) : "--";
  };

  const updatePollInterval = async (secs: number) => {
    dispatch({ type: "UPDATE_SETTINGS", settings: { poll_interval_secs: secs } });
    try {
      await invoke("set_poll_interval", { interval: secs });
    } catch {}
  };

  function handleNavClick(id: NavId) {
    setActiveTab(id);
  }

  return (
    <div className="settings">
      {/* Drag bar / header */}
      <div
        className="settings-header"
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, input, select")) {
            e.preventDefault();
            getCurrentWindow().startDragging();
          }
        }}
      >
        <button
          className="icon-btn back-btn"
          onClick={() => dispatch({ type: "SET_VIEW", view: "popover" })}
        >
          &#x2190;
        </button>
        <span className="settings-title">Settings</span>
      </div>

      {/* Sidebar + content */}
      <div className="settings-body">
        <nav className="settings-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`settings-nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => handleNavClick(item.id)}
            >
              <span className="snav-label">{item.label}</span>
              <span className="snav-sub">{item.sub}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {!state.hasCredentials && (
            <div className="settings-card settings-onboarding-card">
              <p className="card-label">Get Started</p>
              <p className="form-hint" style={{ marginTop: 4 }}>
                Connect at least one provider to start seeing tray, tooltip, and widget data.
                Claude needs a session key and organization. Codex and Cursor can be checked and mapped here too.
              </p>
              <div className="settings-onboarding-actions">
                <button className="btn primary" onClick={() => handleNavClick("account")}>
                  Open provider connections
                </button>
                <button className="btn secondary" onClick={() => handleNavClick("provider")}>
                  Review app mappings
                </button>
              </div>
            </div>
          )}

          {/* ── Account ───────────────────────────────────────── */}
          {activeTab === "account" && (
            <div className="settings-section">
              <ProviderMethodPicker
                provider="Claude"
                onConnected={() => dispatch({ type: "SET_HAS_CREDENTIALS", has: true })}
              />
              <ProviderMethodPicker
                provider="Codex"
                onConnected={() => dispatch({ type: "SET_HAS_CREDENTIALS", has: true })}
              />
              <ProviderMethodPicker
                provider="Cursor"
                onConnected={() => dispatch({ type: "SET_HAS_CREDENTIALS", has: true })}
              />
            </div>
          )}

          {/* ── Menu Bar ──────────────────────────────────────── */}
          {activeTab === "menu-bar" && (
            <div className="settings-section">
              <p className="section-hint">Preview of what appears in the {statusDisplayTarget}.</p>
              <div className="tray-preview">{buildPreview()}</div>

              <div className="settings-card">
                <p className="card-label">{isMacPlatform ? "Show in menu bar" : "Show in tooltip"}</p>
                {[
                  { key: "show_session_pct" as const, label: "Session %" },
                  { key: "show_session_timer" as const, label: "Session countdown" },
                  { key: "show_weekly_pct" as const, label: "Weekly %" },
                  { key: "show_weekly_timer" as const, label: "Weekly countdown" },
                  { key: "show_sonnet_pct" as const, label: "Sonnet %" },
                  { key: "show_opus_pct" as const, label: "Opus %" },
                  { key: "show_extra_usage" as const, label: "Extra usage spend" },
                ].map(({ key, label }) => (
                  <div className="toggle-row" key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={trayFormat[key]}
                        onChange={(e) => updateTrayFormat({ [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  </div>
                ))}
              </div>

              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Separator</label>
                <select
                  className="input"
                  value={trayFormat.separator}
                  onChange={(e) => updateTrayFormat({ separator: e.target.value })}
                >
                  <option value=" | ">Pipe  ( | )</option>
                  <option value=" · ">Dot   ( · )</option>
                  <option value="  ">Space</option>
                  <option value=" / ">Slash ( / )</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Provider ──────────────────────────────────────── */}
          {activeTab === "provider" && (
            <div className="settings-section">
              <p className="section-hint">
                Choose which provider drives the {isMacPlatform ? "menu bar" : "tooltip"} and widget.
              </p>

              <div className="settings-card">
                <p className="card-label">Mode</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="radio"
                      name="tray-mode"
                      checked={isStaticOrMulti(trayConfig.mode)}
                      onChange={() =>
                        updateTrayConfig({
                          mode: { Multi: [
                            { kind: { type: "ProviderData", provider: trayConfig.default_provider, field: "SessionPct" } },
                            { kind: { type: "ProviderData", provider: trayConfig.default_provider, field: "SessionTimer" } },
                          ] },
                        })
                      }
                    />
                    Static — compose segments from any provider
                  </label>
                </div>
                <div className="toggle-row">
                  <label>
                    <input
                      type="radio"
                      name="tray-mode"
                      checked={trayConfig.mode === "Dynamic"}
                      onChange={() => {
                        updateTrayConfig({ mode: "Dynamic" });
                        loadRunningApps();
                      }}
                    />
                    Dynamic — switch based on focused app
                  </label>
                </div>
              </div>

              {isStaticOrMulti(trayConfig.mode) && (
                <SegmentBuilder
                  segments={getMultiSegments(trayConfig)}
                  separator={trayFormat.separator}
                  onUpdate={(segs) => updateTrayConfig({ mode: { Multi: segs } })}
                />
              )}

              {trayConfig.mode === "Dynamic" && (
                <>
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label>Default provider</label>
                    <p className="form-hint">Used when no app mapping matches.</p>
                    <select
                      className="input"
                      value={trayConfig.default_provider}
                      onChange={(e) =>
                        updateTrayConfig({ default_provider: e.target.value as Provider })
                      }
                    >
                      <option value="Claude">Claude</option>
                      <option value="Codex">Codex</option>
                      <option value="Cursor">Cursor</option>
                    </select>
                  </div>

                  {/* Title matching opt-in */}
                  <div className="settings-card" style={{ marginTop: 8 }}>
                    <p className="card-label">Window title matching</p>
                    {isMacPlatform ? (
                      <>
                        <p className="form-hint" style={{ marginTop: 0 }}>
                          Match providers by window title (e.g. iTerm2 tab named "Claude"). Requires Accessibility permission on macOS.
                        </p>
                        <div className="toggle-row" style={{ marginBottom: 8 }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={trayConfig.title_matching_enabled}
                              onChange={(e) => toggleTitleMatching(e.target.checked)}
                              disabled={!accessibilityGranted && !trayConfig.title_matching_enabled}
                            />
                            Enable title matching
                          </label>
                        </div>
                        {accessibilityGranted === false && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              Accessibility not granted
                            </span>
                            <button className="icon-btn" style={{ fontSize: 11, padding: "2px 8px", width: "auto" }} onClick={requestAccessibility}>
                              Open System Settings
                            </button>
                            <button className="icon-btn" style={{ fontSize: 11, padding: "2px 8px", width: "auto" }} onClick={checkAccessibility}>
                              Re-check
                            </button>
                          </div>
                        )}
                        {accessibilityGranted === true && (
                          <span style={{ fontSize: 11, color: "var(--green, #4ade80)" }}>Accessibility granted</span>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="form-hint" style={{ marginTop: 0 }}>
                          Match providers by foreground window title. No extra permissions needed on Windows.
                        </p>
                        <div className="toggle-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={trayConfig.title_matching_enabled}
                              onChange={(e) => toggleTitleMatching(e.target.checked)}
                            />
                            Enable title matching
                          </label>
                        </div>
                      </>
                    )}
                  </div>

                  {(() => {
                    const isWinEntry = (id: string) => /\.(exe|lnk)$/i.test(id);
                    const indexed = trayConfig.app_mappings.map((m, i) => ({ ...m, _idx: i }));
                    const macMappings = indexed.filter(m => !isWinEntry(m.app_identifier));
                    const winMappings = indexed.filter(m => isWinEntry(m.app_identifier));

                    const updateMapping = (idx: number, patch: Partial<AppMapping>) => {
                      const updated = [...trayConfig.app_mappings];
                      updated[idx] = { ...updated[idx], ...patch };
                      updateTrayConfig({ app_mappings: updated });
                    };

                    const renderMappingRow = (mapping: (typeof indexed)[0]) => {
                      const isEditingTitle = editingTitleIdx === mapping._idx;
                      const hasTitle = !!mapping.title_pattern;
                      return (
                        <div key={mapping.app_identifier} style={{ marginBottom: 6 }}>
                          <div className="mapping-row" style={{ marginBottom: 0 }}>
                            <span className="mapping-id" title={mapping.app_identifier}>{mapping.app_identifier}</span>
                            {hasTitle && !isEditingTitle && (
                              <span
                                style={{ fontSize: 10, color: "var(--blue)", flexShrink: 0, cursor: "pointer" }}
                                title="title pattern active — click to edit"
                                onClick={() => setEditingTitleIdx(mapping._idx)}
                              >
                                title∋
                              </span>
                            )}
                            <select
                              className="input mapping-select"
                              value={mapping.provider}
                              onChange={(e) => updateMapping(mapping._idx, { provider: e.target.value as Provider })}
                            >
                              <option value="Claude">Claude</option>
                              <option value="Codex">Codex</option>
                              <option value="Cursor">Cursor</option>
                            </select>
                            {trayConfig.title_matching_enabled && (
                              <button
                                className={`icon-btn${hasTitle ? " active" : ""}`}
                                title={isEditingTitle ? "Close title filter" : "Add/edit title filter"}
                                onClick={() => setEditingTitleIdx(isEditingTitle ? null : mapping._idx)}
                                style={{ fontSize: 11 }}
                              >
                                T
                              </button>
                            )}
                            <button
                              className="icon-btn mapping-remove"
                              onClick={() => updateTrayConfig({ app_mappings: trayConfig.app_mappings.filter((_, i) => i !== mapping._idx) })}
                            >
                              &#215;
                            </button>
                          </div>
                          {isEditingTitle && (
                            <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 2 }}>
                              <input
                                className="input"
                                style={{ flex: 1, fontSize: 11 }}
                                placeholder="Window title must contain…"
                                value={mapping.title_pattern ?? ""}
                                onChange={(e) => updateMapping(mapping._idx, { title_pattern: e.target.value || undefined })}
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      );
                    };

                    const addMapping = () => {
                      if (!newMappingApp) return;
                      updateTrayConfig({ app_mappings: [...trayConfig.app_mappings, { app_identifier: newMappingApp, provider: newMappingProvider }] });
                      setNewMappingApp("");
                      setNewMappingProvider("Claude");
                      setShowAppPicker(false);
                    };

                    const availableApps = runningApps.filter(
                      app => !trayConfig.app_mappings.some(m => m.app_identifier === app.bundle_id)
                    );

                    return (
                      <div className="settings-card" style={{ marginTop: 4 }}>
                        {/* Platform tabs */}
                        <div className="tab-bar" style={{ marginBottom: 8 }}>
                          <button
                            className={`tab-btn${mappingPlatform === "mac" ? " active" : ""}`}
                            onClick={() => { setMappingPlatform("mac"); setShowAppPicker(false); setNewMappingApp(""); }}
                          >
                            macOS
                          </button>
                          <button
                            className={`tab-btn${mappingPlatform === "windows" ? " active" : ""}`}
                            onClick={() => { setMappingPlatform("windows"); setShowAppPicker(false); setNewMappingApp(""); }}
                          >
                            Windows
                          </button>
                        </div>

                        {/* macOS tab */}
                        {mappingPlatform === "mac" && (
                          <>
                            <p className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                              Bundle IDs (e.g. <code>com.anthropic.claudefordesktop</code>) or app names.
                            </p>
                            {macMappings.length > 0
                              ? macMappings.map(renderMappingRow)
                              : <p className="form-hint" style={{ marginBottom: 0 }}>No macOS mappings.</p>
                            }
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                              <div className="mapping-row" style={{ position: "relative" }}>
                                <input
                                  className="input"
                                  style={{ flex: 1 }}
                                  value={newMappingApp}
                                  onChange={(e) => setNewMappingApp(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") addMapping(); }}
                                  placeholder="Bundle ID or app name"
                                />
                                <select className="input mapping-select" value={newMappingProvider} onChange={(e) => setNewMappingProvider(e.target.value as Provider)}>
                                  <option value="Claude">Claude</option>
                                  <option value="Codex">Codex</option>
                                  <option value="Cursor">Cursor</option>
                                </select>
                                {isMacPlatform && (
                                  <button
                                    className={`icon-btn${showAppPicker ? " active" : ""}`}
                                    type="button"
                                    title="Pick from running apps"
                                    onClick={async () => {
                                      if (!showAppPicker && runningApps.length === 0) await loadRunningApps();
                                      setShowAppPicker(p => !p);
                                    }}
                                  >
                                    ◎
                                  </button>
                                )}
                                <button className="icon-btn" type="button" title="Browse for application" onClick={pickMappingTarget}>...</button>
                                <button
                                  className="icon-btn"
                                  style={{ fontSize: 18, fontWeight: 600 }}
                                  disabled={!newMappingApp}
                                  onClick={addMapping}
                                >+</button>
                              </div>
                              {/* Running app picker dropdown */}
                              {showAppPicker && (
                                <div className="app-picker-dropdown">
                                  {availableApps.length === 0
                                    ? <span className="app-picker-empty">No other running apps</span>
                                    : availableApps.map(app => (
                                        <button
                                          key={app.bundle_id}
                                          className="app-picker-row"
                                          onClick={() => { setNewMappingApp(app.bundle_id); setShowAppPicker(false); }}
                                        >
                                          <span className="app-picker-name">{app.name}</span>
                                          <span className="app-picker-id">{app.bundle_id}</span>
                                        </button>
                                      ))
                                  }
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {/* Windows tab */}
                        {mappingPlatform === "windows" && (
                          <>
                            <p className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                              Executable names (e.g. <code>Claude.exe</code>) or process names.
                            </p>
                            {winMappings.length > 0
                              ? winMappings.map(renderMappingRow)
                              : <p className="form-hint" style={{ marginBottom: 0 }}>No Windows mappings.</p>
                            }
                            <div className="mapping-row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                              <input
                                className="input"
                                style={{ flex: 1 }}
                                value={newMappingApp}
                                onChange={(e) => setNewMappingApp(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") addMapping(); }}
                                placeholder="App name or .exe"
                              />
                              <select className="input mapping-select" value={newMappingProvider} onChange={(e) => setNewMappingProvider(e.target.value as Provider)}>
                                <option value="Claude">Claude</option>
                                <option value="Codex">Codex</option>
                                <option value="Cursor">Cursor</option>
                              </select>
                              <button className="icon-btn" type="button" title="Browse for executable" onClick={pickMappingTarget}>...</button>
                              <button
                                className="icon-btn"
                                style={{ fontSize: 18, fontWeight: 600 }}
                                disabled={!newMappingApp}
                                onClick={addMapping}
                              >+</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {activeTab === "widget" && (
            <div className="settings-section">
              <div className="settings-card settings-theme-picker" style={{ padding: "8px" }}>
                <div className="settings-theme-grid-compact">
                  {ALL_WIDGET_THEME_IDS.map((themeId) => {
                    const theme = WIDGET_THEME_CATALOG[themeId];
                    const selected = widgetLayout.themeId === themeId;
                    return (
                      <button
                        key={themeId}
                        type="button"
                        className={`settings-theme-chip${selected ? " selected" : ""}`}
                        onClick={() => updateWidgetLayout({ themeId })}
                        aria-pressed={selected}
                      >
                        <span className="settings-theme-chip-name">{theme.name}</span>
                        {theme.bestForLaptop && <span className="theme-badge" style={{ fontSize: "8px", padding: "1px 4px" }}>S</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Density</label>
                <select
                  className="input"
                  value={widgetLayout.density}
                  onChange={(e) => updateWidgetLayout({ density: e.target.value as WidgetDensity })}
                >
                  <option value="ultra-compact">Ultra compact</option>
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
                <p className="form-hint" style={{ marginTop: 8 }}>
                  Ultra compact is the new smallest footprint. Compact keeps a bit more context. Comfortable preserves the fullest labels and spacing.
                </p>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Scale</p>
                <p className="form-hint" style={{ marginTop: 0 }}>
                  Shrinks or enlarges the whole widget after density is applied. Useful when you like a theme but want it materially smaller.
                </p>
                <input
                  type="range"
                  min={50}
                  max={115}
                  step={5}
                  value={Math.round(widgetLayout.scale * 100)}
                  onChange={(e) => updateWidgetLayout({ scale: Number(e.target.value) / 100 })}
                  className="slider"
                />
                <div className="slider-labels">
                  <span>50%</span>
                  <span>{Math.round(widgetLayout.scale * 100)}%</span>
                  <span>115%</span>
                </div>
              </div>

              {widgetLayout.themeId === "matrix-rain" && (
                <div className="settings-card" style={{ marginTop: 10 }}>
                  <p className="card-label">Rain color</p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <input
                      type="color"
                      value={(widgetLayout.themeOverrides["matrix-rain"]?.accentColor as string) || "#00ff41"}
                      onChange={(e) => updateWidgetLayout({
                        themeOverrides: {
                          ...widgetLayout.themeOverrides,
                          "matrix-rain": {
                            ...widgetLayout.themeOverrides["matrix-rain"],
                            accentColor: e.target.value,
                          },
                        },
                      })}
                      style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {((widgetLayout.themeOverrides["matrix-rain"]?.accentColor as string) || "#00ff41").toUpperCase()}
                    </span>
                    {(widgetLayout.themeOverrides["matrix-rain"]?.accentColor as string) && (
                      <button
                        className="icon-btn"
                        style={{ fontSize: 10 }}
                        onClick={() => {
                          const next = { ...widgetLayout.themeOverrides };
                          if (next["matrix-rain"]) {
                            const { accentColor: _, ...rest } = next["matrix-rain"];
                            next["matrix-rain"] = rest;
                          }
                          updateWidgetLayout({ themeOverrides: next });
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Cards</p>
                <WidgetCardConfigurator
                  cardOrder={widgetLayout.cardOrder}
                  cardVisibility={widgetLayout.cardVisibility}
                  onReorder={reorderCards}
                  onVisibilityChange={updateCardVisibility}
                />
              </div>
            </div>
          )}

          {/* ── Alerts ────────────────────────────────────────── */}
          {activeTab === "alerts" && (
            <div className="settings-section">
              <div className="settings-card">
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={alertConfig.enabled}
                      onChange={(e) => updateAlertConfig({ enabled: e.target.checked })}
                    />
                    Enable alerts
                  </label>
                </div>

                {alertConfig.enabled && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <div className="form-group">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: 12 }}>Session Usage Threshold</label>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                          {alertConfig.session_threshold === 0 ? "Disabled" : `${alertConfig.session_threshold}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={alertConfig.session_threshold}
                        onChange={(e) => updateAlertConfig({ session_threshold: Number(e.target.value) })}
                        className="slider"
                      />
                      <p className="section-hint">Alert when session usage exceeds this level</p>
                    </div>

                    <div className="form-group">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: 12 }}>Weekly Usage Threshold</label>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                          {alertConfig.weekly_threshold === 0 ? "Disabled" : `${alertConfig.weekly_threshold}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={alertConfig.weekly_threshold}
                        onChange={(e) => updateAlertConfig({ weekly_threshold: Number(e.target.value) })}
                        className="slider"
                      />
                      <p className="section-hint">Alert when weekly usage exceeds this level</p>
                    </div>

                    <div className="form-group">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: 12 }}>Burn Rate Warning</label>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                          {alertConfig.burn_rate_mins === 0 ? "Disabled" : `${alertConfig.burn_rate_mins} min`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={120}
                        step={5}
                        value={alertConfig.burn_rate_mins}
                        onChange={(e) => updateAlertConfig({ burn_rate_mins: Number(e.target.value) })}
                        className="slider"
                      />
                      <p className="section-hint">Alert when estimated time-to-limit drops below this</p>
                    </div>

                    <div className="toggle-row" style={{ marginTop: 4 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={alertConfig.notify_on_reset}
                          onChange={(e) => updateAlertConfig({ notify_on_reset: e.target.checked })}
                        />
                        Reset notifications
                      </label>
                    </div>
                    <p className="section-hint" style={{ marginTop: 2 }}>
                      Notify when a usage window resets after heavy use
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── General ───────────────────────────────────────── */}
          {activeTab === "general" && (
            <div className="settings-section">
              <div className="settings-card">
                <p className="card-label">Usage display</p>
                <p className="form-hint">Applies to the main app views that show percentages.</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.show_remaining}
                      onChange={(e) =>
                        dispatch({
                          type: "UPDATE_SETTINGS",
                          settings: { show_remaining: e.target.checked },
                        })
                      }
                    />
                    Show remaining % instead of used %
                  </label>
                </div>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Refresh interval</p>
                <p className="form-hint">{formatPollInterval(settings.poll_interval_secs)}</p>
                <input
                  type="range"
                  min={30}
                  max={300}
                  step={10}
                  value={settings.poll_interval_secs}
                  onChange={(e) => updatePollInterval(Number(e.target.value))}
                  className="slider"
                />
                <div className="slider-labels">
                  <span>30s</span>
                  <span>5m</span>
                </div>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Startup</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.autostart}
                      onChange={(e) =>
                        dispatch({
                          type: "UPDATE_SETTINGS",
                          settings: { autostart: e.target.checked },
                        })
                      }
                    />
                    Launch at login
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── Debug (dev only) ────────────────────────────────── */}
          {IS_DEV && activeTab === "debug" && (
            <div className="settings-section">
              <DebugPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
