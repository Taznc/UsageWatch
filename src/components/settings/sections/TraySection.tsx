import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Toggle } from "../shared/Toggle";
import { SettingRow } from "../shared/SettingRow";
import { SettingGroup } from "../shared/SettingGroup";
import { Accordion } from "../shared/Accordion";
import type {
  TrayFormat,
  TrayConfig,
  TraySegmentDef,
  TrayField,
  RunningApp,
  Provider,
  AppMapping,
} from "../../../types/usage";

const isMac = /mac/i.test(navigator.userAgent);

// ── Helpers (verbatim from original Settings.tsx) ────────────────────────────

function normalizePickedMapping(path: string): string {
  const normalized = path.split(/[/\\]/).pop()?.trim() ?? path.trim();
  return normalized.replace(/\.app$/i, "").replace(/\.exe$/i, "").replace(/\.lnk$/i, "");
}

const PROVIDER_EMOJI: Record<Provider, string> = {
  Claude: "\u{1F7E0}",
  Codex: "\u{1F7E2}",
  Cursor: "\u{1F7E3}",
};

const TRAY_FIELD_OPTIONS: { value: TrayField; label: string; providerOnly?: Provider }[] = [
  { value: "SessionPct",   label: "Session %" },
  { value: "SessionTimer", label: "Session countdown" },
  { value: "WeeklyPct",    label: "Weekly %" },
  { value: "WeeklyTimer",  label: "Weekly countdown" },
  { value: "SonnetPct",    label: "Sonnet %",  providerOnly: "Claude" },
  { value: "OpusPct",      label: "Opus %",    providerOnly: "Claude" },
  { value: "DesignPct",    label: "Design %",  providerOnly: "Claude" },
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
  const field = TRAY_FIELD_OPTIONS.find((f) => f.value === k.field);
  return `${PROVIDER_EMOJI[k.provider]} ${field?.label ?? k.field}`;
}

// ── Default state ────────────────────────────────────────────────────────────

const DEFAULT_FORMAT: TrayFormat = {
  show_session_pct: true,
  show_weekly_pct: true,
  show_sonnet_pct: false,
  show_opus_pct: false,
  show_design_pct: false,
  show_session_timer: true,
  show_weekly_timer: false,
  show_extra_usage: false,
  separator: " | ",
};

const DEFAULT_CONFIG: TrayConfig = {
  mode: "Dynamic",
  app_mappings: [
    { app_identifier: "com.anthropic.claudefordesktop", provider: "Claude" },
    { app_identifier: "com.openai.codex", provider: "Codex" },
    { app_identifier: "Cursor.exe", provider: "Cursor" },
  ],
  default_provider: "Claude",
  title_matching_enabled: false,
};

// ── Segment Builder sub-component ────────────────────────────────────────────

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
    (f) => !f.providerOnly || f.providerOnly === addProvider
  );

  return (
    <div>
      {/* Live preview */}
      <div className="s-tray-preview" style={{ margin: "0 0 8px" }}>
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
      <div className="s-segment-list">
        {segments.map((seg, i) => (
          <div key={i} className="s-segment-row">
            <span className="s-segment-preview">{segmentPreview(seg)}</span>
            <button className="s-icon-btn" onClick={() => moveUp(i)} disabled={i === 0} title="Move up" style={{ fontSize: 11 }}>▲</button>
            <button className="s-icon-btn" onClick={() => moveDown(i)} disabled={i === segments.length - 1} title="Move down" style={{ fontSize: 11 }}>▼</button>
            <button className="s-icon-btn danger" onClick={() => remove(i)} title="Remove">×</button>
          </div>
        ))}
      </div>

      {/* Add controls */}
      <div className="s-segment-add">
        <select
          className="s-select"
          value={addKind}
          onChange={(e) => setAddKind(e.target.value as "ProviderData" | "CustomText")}
          style={{ maxWidth: "unset", flex: "0 0 auto" }}
        >
          <option value="ProviderData">Provider data</option>
          <option value="CustomText">Custom text</option>
        </select>

        {addKind === "ProviderData" && (
          <>
            <select
              className="s-select"
              value={addProvider}
              onChange={(e) => { setAddProvider(e.target.value as Provider); setAddField("SessionPct"); }}
              style={{ maxWidth: "unset", flex: "0 0 auto" }}
            >
              <option value="Claude">Claude</option>
              <option value="Codex">Codex</option>
              <option value="Cursor">Cursor</option>
            </select>
            <select
              className="s-select"
              value={addField}
              onChange={(e) => setAddField(e.target.value as TrayField)}
              style={{ maxWidth: "unset", flex: "0 0 auto" }}
            >
              {fieldsForProvider.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </>
        )}

        {addKind === "CustomText" && (
          <input
            className="s-input-sm"
            placeholder="Custom text"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSegment(); }}
          />
        )}

        <button
          className="s-icon-btn"
          style={{ fontSize: 16, fontWeight: 600, width: 28, height: 28 }}
          onClick={addSegment}
          title="Add segment"
        >+</button>
      </div>
    </div>
  );
}

// ── Main TraySection ─────────────────────────────────────────────────────────

export function TraySection() {
  const [fmt, setFmt] = useState<TrayFormat>(DEFAULT_FORMAT);
  const [cfg, setCfg] = useState<TrayConfig>(DEFAULT_CONFIG);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [editingTitleIdx, setEditingTitleIdx] = useState<number | null>(null);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [newMappingApp, setNewMappingApp] = useState("");
  const [newMappingProvider, setNewMappingProvider] = useState<Provider>("Claude");
  const [mappingPlatform, setMappingPlatform] = useState<"mac" | "windows">(isMac ? "mac" : "windows");
  const [showAppPicker, setShowAppPicker] = useState(false);

  useEffect(() => {
    invoke<TrayFormat>("get_tray_format").then(setFmt).catch(() => {});
    invoke<TrayConfig>("get_tray_config").then(setCfg).catch(() => {});
    if (isMac) checkAccessibility();
  }, []);

  const updateFmt = async (updates: Partial<TrayFormat>) => {
    const next = { ...fmt, ...updates };
    setFmt(next);
    try { await invoke("set_tray_format", { format: next }); } catch {}
  };

  const updateCfg = async (updates: Partial<TrayConfig>) => {
    const next = { ...cfg, ...updates };
    setCfg(next);
    try { await invoke("set_tray_config", { config: next }); } catch {}
  };

  const toggleTitleMatching = async (enabled: boolean) => {
    try { await invoke("set_title_matching_enabled", { enabled }); } catch {}
    updateCfg({ title_matching_enabled: enabled });
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
      let attempts = 0;
      const poll = setInterval(async () => {
        const granted = await invoke<boolean>("check_accessibility_permission");
        setAccessibilityGranted(granted);
        if (granted || ++attempts >= 10) clearInterval(poll);
      }, 1500);
    } catch {}
  };

  const loadRunningApps = async () => {
    try {
      const apps = await invoke<RunningApp[]>("get_running_apps");
      setRunningApps(apps.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {}
  };

  const pickMappingTarget = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: isMac ? "Pick an app" : "Pick an app or executable",
        filters: isMac
          ? [{ name: "Applications", extensions: ["app"] }]
          : [
              { name: "Executables", extensions: ["exe", "lnk"] },
              { name: "Applications", extensions: ["exe", "lnk", "app"] },
            ],
      });
      if (typeof selected === "string" && selected.trim()) {
        setNewMappingApp(normalizePickedMapping(selected));
      }
    } catch {}
  };

  const buildPreview = (): string => {
    const parts: string[] = [];
    if (fmt.show_session_pct || fmt.show_session_timer) {
      const sub: string[] = [];
      if (fmt.show_session_pct) sub.push("S:42%");
      if (fmt.show_session_timer) sub.push("2h9m");
      parts.push(sub.join(" "));
    }
    if (fmt.show_weekly_pct || fmt.show_weekly_timer) {
      const sub: string[] = [];
      if (fmt.show_weekly_pct) sub.push("W:85%");
      if (fmt.show_weekly_timer) sub.push("3d15h");
      parts.push(sub.join(" "));
    }
    if (fmt.show_sonnet_pct) parts.push("So:8%");
    if (fmt.show_opus_pct) parts.push("Op:15%");
    if (fmt.show_design_pct) parts.push("Dz:22%");
    if (fmt.show_extra_usage) parts.push("$5/$20");
    return parts.length > 0 ? parts.join(fmt.separator) : "--";
  };

  // ── Mapping helpers ──────────────────────────────────────────────────────

  const isWinEntry = (id: string) => /\.(exe|lnk)$/i.test(id);
  const indexed = cfg.app_mappings.map((m, i) => ({ ...m, _idx: i }));
  const macMappings = indexed.filter((m) => !isWinEntry(m.app_identifier));
  const winMappings = indexed.filter((m) => isWinEntry(m.app_identifier));

  const updateMapping = (idx: number, patch: Partial<AppMapping>) => {
    const updated = [...cfg.app_mappings];
    updated[idx] = { ...updated[idx], ...patch };
    updateCfg({ app_mappings: updated });
  };

  const removeMapping = (idx: number) => {
    updateCfg({ app_mappings: cfg.app_mappings.filter((_, i) => i !== idx) });
  };

  const addMapping = () => {
    if (!newMappingApp) return;
    updateCfg({
      app_mappings: [...cfg.app_mappings, { app_identifier: newMappingApp, provider: newMappingProvider }],
    });
    setNewMappingApp("");
    setNewMappingProvider("Claude");
    setShowAppPicker(false);
  };

  const availableApps = runningApps.filter(
    (app) => !cfg.app_mappings.some((m) => m.app_identifier === app.bundle_id)
  );

  const renderMappingRow = (mapping: (typeof indexed)[0]) => {
    const isEditingTitle = editingTitleIdx === mapping._idx;
    const hasTitle = !!mapping.title_pattern;
    return (
      <div key={mapping._idx} style={{ marginBottom: 2 }}>
        <div className="s-mapping-row">
          <span className="s-mapping-id" title={mapping.app_identifier}>
            {mapping.app_identifier}
          </span>
          {hasTitle && !isEditingTitle && (
            <span
              style={{ fontSize: 10, color: "var(--s-blue)", flexShrink: 0, cursor: "pointer" }}
              title="title pattern active — click to edit"
              onClick={() => setEditingTitleIdx(mapping._idx)}
            >
              T∋
            </span>
          )}
          <select
            className="s-mapping-select"
            value={mapping.provider}
            onChange={(e) => updateMapping(mapping._idx, { provider: e.target.value as Provider })}
          >
            <option value="Claude">Claude</option>
            <option value="Codex">Codex</option>
            <option value="Cursor">Cursor</option>
          </select>
          {cfg.title_matching_enabled && (
            <button
              className={`s-icon-btn${hasTitle ? " active" : ""}`}
              title={isEditingTitle ? "Close title filter" : "Add/edit title filter"}
              onClick={() => setEditingTitleIdx(isEditingTitle ? null : mapping._idx)}
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              T
            </button>
          )}
          <button className="s-icon-btn danger" onClick={() => removeMapping(mapping._idx)}>×</button>
        </div>
        {isEditingTitle && (
          <div className="s-title-input-row">
            <input
              className="s-input-sm"
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

  const mappingsForPlatform = mappingPlatform === "mac" ? macMappings : winMappings;

  // ── Render ───────────────────────────────────────────────────────────────

  const displayToggles: { key: keyof TrayFormat & `show_${string}`; label: string }[] = [
    { key: "show_session_pct",   label: "Session %" },
    { key: "show_session_timer", label: "Session countdown" },
    { key: "show_weekly_pct",    label: "Weekly %" },
    { key: "show_weekly_timer",  label: "Weekly countdown" },
    { key: "show_sonnet_pct",    label: "Sonnet %" },
    { key: "show_opus_pct",      label: "Opus %" },
    { key: "show_design_pct",    label: "Design %" },
    { key: "show_extra_usage",   label: "Extra usage spend" },
  ];

  return (
    <div>
      {/* Preview */}
      <div className="s-tray-preview" title={isMac ? "Menu bar preview" : "Tray tooltip preview"}>{buildPreview()}</div>

      {/* Display fields */}
      <SettingGroup label={isMac ? "Show in menu bar" : "Show in tray tooltip"}>
        {displayToggles.map(({ key, label }) => (
          <SettingRow key={key} label={label}>
            <Toggle
              checked={fmt[key] as boolean}
              onChange={(v) => updateFmt({ [key]: v })}
            />
          </SettingRow>
        ))}
        <SettingRow label="Separator">
          <select
            className="s-select"
            value={fmt.separator}
            onChange={(e) => updateFmt({ separator: e.target.value })}
          >
            <option value=" | ">Pipe ( | )</option>
            <option value=" · ">Dot ( · )</option>
            <option value="  ">Space</option>
            <option value=" / ">Slash ( / )</option>
          </select>
        </SettingRow>
      </SettingGroup>

      {/* Switching */}
      <SettingGroup label="Switching">
        {/* Mode pills */}
        <div className="s-row">
          <div className="s-row-left">
            <div className="s-row-label">Mode</div>
          </div>
          <div className="s-mode-pills" style={{ flex: "0 0 auto" }}>
            <button
              className={`s-mode-pill${cfg.mode === "Dynamic" ? " active" : ""}`}
              onClick={() => { updateCfg({ mode: "Dynamic" }); loadRunningApps(); }}
              type="button"
            >
              Dynamic
            </button>
            <button
              className={`s-mode-pill${isStaticOrMulti(cfg.mode) ? " active" : ""}`}
              onClick={() =>
                updateCfg({
                  mode: {
                    Multi: [
                      { kind: { type: "ProviderData", provider: cfg.default_provider, field: "SessionPct" } },
                      { kind: { type: "ProviderData", provider: cfg.default_provider, field: "SessionTimer" } },
                    ],
                  },
                })
              }
              type="button"
            >
              Static
            </button>
          </div>
        </div>

        {/* Dynamic mode settings */}
        {cfg.mode === "Dynamic" && (
          <>
            <SettingRow label="Default provider" hint="Used when no app mapping matches">
              <select
                className="s-select"
                value={cfg.default_provider}
                onChange={(e) => updateCfg({ default_provider: e.target.value as Provider })}
              >
                <option value="Claude">Claude</option>
                <option value="Codex">Codex</option>
                <option value="Cursor">Cursor</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Title matching"
              hint={
                isMac
                  ? "Match providers by window title — requires Accessibility permission"
                  : "Match providers by foreground window title"
              }
            >
              <Toggle
                checked={cfg.title_matching_enabled}
                onChange={toggleTitleMatching}
                disabled={isMac && !accessibilityGranted && !cfg.title_matching_enabled}
              />
            </SettingRow>

            {/* Accessibility status (macOS only) */}
            {isMac && cfg.title_matching_enabled && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid var(--s-border)" }}>
                {accessibilityGranted === false && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="s-status-chip s-status-chip--warn">Accessibility not granted</span>
                    <button className="s-btn-sm" onClick={requestAccessibility}>Open System Settings</button>
                    <button className="s-btn-sm" onClick={checkAccessibility}>Re-check</button>
                  </div>
                )}
                {accessibilityGranted === true && (
                  <span className="s-status-chip s-status-chip--ok">✓ Accessibility granted</span>
                )}
              </div>
            )}
          </>
        )}

        {/* Static mode: segment builder */}
        {isStaticOrMulti(cfg.mode) && (
          <div style={{ padding: "10px 12px" }}>
            <SegmentBuilder
              segments={getMultiSegments(cfg)}
              separator={fmt.separator}
              onUpdate={(segs) => updateCfg({ mode: { Multi: segs } })}
            />
          </div>
        )}
      </SettingGroup>

      {/* App Mappings accordion (Dynamic mode only) */}
      {cfg.mode === "Dynamic" && (
        <Accordion label="Advanced — App Mappings">
          {/* Platform tabs */}
          <div className="s-platform-tabs">
            <button
              className={`s-platform-tab${mappingPlatform === "mac" ? " active" : ""}`}
              onClick={() => { setMappingPlatform("mac"); setShowAppPicker(false); setNewMappingApp(""); }}
              type="button"
            >
              macOS
            </button>
            <button
              className={`s-platform-tab${mappingPlatform === "windows" ? " active" : ""}`}
              onClick={() => { setMappingPlatform("windows"); setShowAppPicker(false); setNewMappingApp(""); }}
              type="button"
            >
              Windows
            </button>
          </div>

          {/* Existing mappings */}
          {mappingsForPlatform.length > 0
            ? mappingsForPlatform.map(renderMappingRow)
            : (
              <p style={{ fontSize: 11, color: "var(--s-text-muted)", margin: "0 0 8px" }}>
                No {mappingPlatform === "mac" ? "macOS" : "Windows"} mappings.
              </p>
            )
          }

          {/* Add mapping row */}
          <div className="s-add-row">
            <input
              className="s-input-sm"
              value={newMappingApp}
              onChange={(e) => setNewMappingApp(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addMapping(); }}
              placeholder={mappingPlatform === "mac" ? "Bundle ID or app name" : "App name or .exe"}
            />
            <select
              className="s-mapping-select"
              value={newMappingProvider}
              onChange={(e) => setNewMappingProvider(e.target.value as Provider)}
            >
              <option value="Claude">Claude</option>
              <option value="Codex">Codex</option>
              <option value="Cursor">Cursor</option>
            </select>
            {isMac && mappingPlatform === "mac" && (
              <button
                className={`s-icon-btn${showAppPicker ? " active" : ""}`}
                type="button"
                title="Pick from running apps"
                onClick={async () => {
                  if (!showAppPicker && runningApps.length === 0) await loadRunningApps();
                  setShowAppPicker((p) => !p);
                }}
                style={{ fontSize: 13 }}
              >
                ◎
              </button>
            )}
            <button className="s-icon-btn" type="button" title="Browse" onClick={pickMappingTarget} style={{ fontSize: 11 }}>…</button>
            <button
              className="s-icon-btn"
              style={{ fontSize: 16, fontWeight: 600, width: 28, height: 28 }}
              disabled={!newMappingApp}
              onClick={addMapping}
              type="button"
            >+</button>
          </div>

          {/* Running app picker dropdown */}
          {showAppPicker && (
            <div className="s-app-picker">
              {availableApps.length === 0
                ? <span className="s-app-picker-empty">No other running apps</span>
                : availableApps.map((app) => (
                    <button
                      key={app.bundle_id}
                      className="s-app-picker-row"
                      type="button"
                      onClick={() => { setNewMappingApp(app.bundle_id); setShowAppPicker(false); }}
                    >
                      <span className="s-app-picker-name">{app.name}</span>
                      <span className="s-app-picker-id">{app.bundle_id}</span>
                    </button>
                  ))
              }
            </div>
          )}
        </Accordion>
      )}
    </div>
  );
}
