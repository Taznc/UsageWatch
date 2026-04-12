import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { useApp } from "../context/AppContext";
import { formatPollInterval } from "../utils/format";
import { DebugPanel } from "./DebugPanel";
import type { Organization, TrayFormat, TrayConfig, RunningApp, Provider, AlertConfig } from "../types/usage";
import { DEFAULT_WIDGET_PREFERENCES, type WidgetLayout, type WidgetPreferences } from "../types/widget";

interface BrowserResult {
  browser: string;
  session_key: string | null;
}

type NavId = "account" | "menu-bar" | "provider" | "widget" | "alerts" | "general" | "debug";

const NAV_ITEMS: { id: NavId; label: string; sub: string }[] = [
  { id: "account",   label: "Account",   sub: "Session key & org" },
  { id: "menu-bar",  label: "Menu Bar",  sub: "Tray display" },
  { id: "provider",  label: "Provider",  sub: "Active AI service" },
  { id: "widget",    label: "Widget",    sub: "Compact dashboards" },
  { id: "alerts",    label: "Alerts",    sub: "Notifications" },
  { id: "general",   label: "General",   sub: "Polling & startup" },
  { id: "debug",     label: "Debug",     sub: "Diagnostics" },
];

export function Settings() {
  const { state, dispatch } = useApp();
  const { settings } = state;

  // ── Claude state ──────────────────────────────────────────────────────────
  const [sessionKey, setSessionKey] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [connectedOrgName, setConnectedOrgName] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<BrowserResult[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  // ── Codex state ───────────────────────────────────────────────────────────
  const [codexConnected, setCodexConnected] = useState<boolean | null>(null);
  const [codexChecking, setCodexChecking] = useState(false);

  // ── Cursor state ──────────────────────────────────────────────────────────
  const [cursorConnected, setCursorConnected] = useState<boolean | null>(null);
  const [cursorEmail, setCursorEmail] = useState<string | null>(null);
  const [cursorChecking, setCursorChecking] = useState(false);
  const [cursorAuthPath, setCursorAuthPath] = useState<string>("");
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
  });
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [newMappingApp, setNewMappingApp] = useState("");
  const [newMappingProvider, setNewMappingProvider] = useState<Provider>("Claude");
  const [widgetPreferences, setWidgetPreferences] = useState<WidgetPreferences>(DEFAULT_WIDGET_PREFERENCES);

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
    async function loadWidgetPreferences() {
      try {
        const store = await load("credentials.json", { autoSave: false, defaults: {} });
        const saved = await store.get<WidgetLayout>("widget_layout");
        const prefs = saved?.preferences;
        if (prefs) {
          setWidgetPreferences({
            ...DEFAULT_WIDGET_PREFERENCES,
            ...prefs,
            claude: { ...DEFAULT_WIDGET_PREFERENCES.claude, ...prefs.claude },
            codex: { ...DEFAULT_WIDGET_PREFERENCES.codex, ...prefs.codex },
            cursor: { ...DEFAULT_WIDGET_PREFERENCES.cursor, ...prefs.cursor },
          });
        }
      } catch {}
    }
    loadTrayFormat();
    loadTrayConfig();
    loadAlertConfig();
    loadWidgetPreferences();
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

  const updateWidgetPreferences = async (updates: Partial<WidgetPreferences>) => {
    const next: WidgetPreferences = {
      ...widgetPreferences,
      ...updates,
      claude: { ...widgetPreferences.claude, ...updates.claude },
      codex: { ...widgetPreferences.codex, ...updates.codex },
      cursor: { ...widgetPreferences.cursor, ...updates.cursor },
    };
    setWidgetPreferences(next);
    try {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      const saved = await store.get<WidgetLayout>("widget_layout");
      await store.set("widget_layout", {
        version: saved?.version ?? 1,
        position: saved?.position ?? { x: 200, y: 100 },
        preferences: next,
      } satisfies WidgetLayout);
      await store.save();
    } catch {}
  };

  const loadRunningApps = async () => {
    try {
      const apps = await invoke<RunningApp[]>("get_running_apps");
      setRunningApps(apps.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {}
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

  useEffect(() => {
    async function loadCredentials() {
      try {
        const key = await invoke<string | null>("get_session_key");
        const org = await invoke<string | null>("get_org_id");
        if (key) setSessionKey(key);
        if (org) setOrgId(org);

        // Silently fetch orgs to resolve the connected org name for display
        if (key && org) {
          try {
            const orgList = await invoke<Organization[]>("test_connection", { sessionKey: key });
            setOrgs(orgList);
            const found = orgList.find((o) => o.uuid === org);
            if (found) setConnectedOrgName(found.name);
          } catch {
            // Non-critical — connected status still shown via key presence
          }
        }
      } catch {}
    }

    async function checkCodex() {
      try {
        const ok = await invoke<boolean>("check_codex_auth");
        setCodexConnected(ok);
      } catch {
        setCodexConnected(false);
      }
    }

    async function checkCursor() {
      try {
        // Load the platform-specific path first (always available, no auth needed)
        const authPath = await invoke<string>("get_cursor_auth_path");
        setCursorAuthPath(authPath);

        const ok = await invoke<boolean>("check_cursor_auth");
        setCursorConnected(ok);
        if (ok) {
          const email = await invoke<string | null>("get_cursor_email");
          setCursorEmail(email);
        }
      } catch {
        setCursorConnected(false);
      }
    }

    loadCredentials();
    checkCodex();
    checkCursor();
  }, []);

  const testAndSave = async () => {
    setTesting(true);
    setError("");
    setSaveStatus("");
    try {
      const orgList = await invoke<Organization[]>("test_connection", {
        sessionKey: sessionKey.trim(),
      });
      setOrgs(orgList);
      await invoke("save_session_key", { key: sessionKey.trim() });
      setSaveStatus("Connected! Select your organization below.");
    } catch (e: any) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const saveOrg = async (newOrgId: string) => {
    setOrgId(newOrgId);
    try {
      await invoke("save_org_id", { orgId: newOrgId });
      dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
      const found = orgs.find((o) => o.uuid === newOrgId);
      if (found) setConnectedOrgName(found.name);
      setSaveStatus("Organization saved.");
    } catch (e: any) {
      setError(String(e));
    }
  };

  const updatePollInterval = async (secs: number) => {
    dispatch({ type: "UPDATE_SETTINGS", settings: { poll_interval_secs: secs } });
    try {
      await invoke("set_poll_interval", { interval: secs });
    } catch {}
  };

  const recheckCodex = async () => {
    setCodexChecking(true);
    try {
      const ok = await invoke<boolean>("check_codex_auth");
      setCodexConnected(ok);
    } catch {
      setCodexConnected(false);
    } finally {
      setCodexChecking(false);
    }
  };

  const recheckCursor = async () => {
    setCursorChecking(true);
    try {
      const ok = await invoke<boolean>("check_cursor_auth");
      setCursorConnected(ok);
      if (ok) {
        const email = await invoke<string | null>("get_cursor_email");
        setCursorEmail(email);
      } else {
        setCursorEmail(null);
        // Re-fetch path in case it changed (e.g. different OS after config copy)
        const authPath = await invoke<string>("get_cursor_auth_path");
        setCursorAuthPath(authPath);
      }
    } catch {
      setCursorConnected(false);
      setCursorEmail(null);
    } finally {
      setCursorChecking(false);
    }
  };

  function handleNavClick(id: NavId) {
    setActiveTab(id);
    setSaveStatus("");
    setError("");
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
          {/* ── Account ───────────────────────────────────────── */}
          {activeTab === "account" && (
            <div className="settings-section">

              {/* Claude card */}
              <div className="account-card">
                <div className="account-card-header">
                  <div className="account-card-title">
                    <span className="account-provider-name">Claude</span>
                    <span className={`account-status-badge ${sessionKey && orgId ? "connected" : "disconnected"}`}>
                      {sessionKey && orgId ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  {connectedOrgName && (
                    <p className="account-org-name">{connectedOrgName}</p>
                  )}
                </div>

                {/* Scan results — shown after auto-detect */}
                {scanResults.length > 0 && (
                  <div className="scan-results">
                    <p className="card-label">Found in:</p>
                    {scanResults.map((r) => (
                      <button
                        key={r.browser}
                        className={`scan-source-btn ${sessionKey === r.session_key ? "selected" : ""}`}
                        onClick={() => {
                          if (r.session_key) setSessionKey(r.session_key);
                        }}
                      >
                        <span className="scan-source-icon">
                          {r.browser === "Claude Desktop" ? "◆" : "◉"}
                        </span>
                        {r.browser}
                        {r.browser === "Claude Desktop" && (
                          <span className="scan-source-recommended">recommended</span>
                        )}
                      </button>
                    ))}
                    {sessionKey && (
                      <button
                        className="btn primary"
                        style={{ marginTop: 8, width: "100%" }}
                        onClick={testAndSave}
                        disabled={testing}
                      >
                        {testing ? "Verifying..." : "Use selected & save"}
                      </button>
                    )}
                  </div>
                )}

                {scanResults.length === 0 && (
                  <button
                    className="btn secondary full-width"
                    onClick={async () => {
                      setScanning(true);
                      setError("");
                      setSaveStatus("");
                      setScanResults([]);
                      try {
                        const results = await invoke<BrowserResult[]>("pull_session_from_browsers");
                        const valid = results.filter((r) => r.session_key);
                        if (valid.length > 0) {
                          // Prefer Claude Desktop; fall back to first browser found
                          const preferred =
                            valid.find((r) => r.browser === "Claude Desktop") ?? valid[0];
                          setScanResults(valid);
                          if (preferred.session_key) setSessionKey(preferred.session_key);
                        } else {
                          setError("No Claude session found in the app or any browser.");
                        }
                      } catch (e: any) {
                        setError(String(e));
                      } finally {
                        setScanning(false);
                      }
                    }}
                    disabled={scanning}
                  >
                    {scanning ? "Scanning..." : "Auto-detect from app or browser"}
                  </button>
                )}

                {scanResults.length > 0 && (
                  <button
                    className="account-text-btn"
                    onClick={() => {
                      setScanResults([]);
                      setSessionKey("");
                      setSaveStatus("");
                      setError("");
                    }}
                  >
                    Clear & re-scan
                  </button>
                )}

                {/* Manual entry — collapsed by default */}
                <button
                  className="account-text-btn"
                  onClick={() => setShowManual((v) => !v)}
                  style={{ marginTop: scanResults.length === 0 ? 8 : 0 }}
                >
                  {showManual ? "Hide manual entry" : "Enter session key manually"}
                </button>

                {showManual && (
                  <div style={{ marginTop: 10 }}>
                    <div className="form-group">
                      <label htmlFor="settings-key">Session key</label>
                      <input
                        id="settings-key"
                        type="password"
                        value={sessionKey}
                        onChange={(e) => setSessionKey(e.target.value)}
                        placeholder="sk-ant-sid01-..."
                        className="input"
                      />
                    </div>
                    <button
                      className="btn primary"
                      onClick={testAndSave}
                      disabled={testing || !sessionKey}
                      style={{ width: "100%" }}
                    >
                      {testing ? "Testing..." : "Test & Save"}
                    </button>
                  </div>
                )}

                {/* Org selector — appears after successful test */}
                {orgs.length > 0 && (
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label htmlFor="settings-org">Organization</label>
                    <select
                      id="settings-org"
                      value={orgId}
                      onChange={(e) => saveOrg(e.target.value)}
                      className="input"
                    >
                      <option value="">Select organization...</option>
                      {orgs.map((org) => (
                        <option key={org.uuid} value={org.uuid}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {saveStatus && <div className="form-success" style={{ marginTop: 8 }}>{saveStatus}</div>}
                {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
              </div>

              {/* Codex card */}
              <div className="account-card" style={{ marginTop: 10 }}>
                <div className="account-card-header">
                  <div className="account-card-title">
                    <span className="account-provider-name">Codex</span>
                    <span className={`account-status-badge ${codexConnected === true ? "connected" : codexConnected === false ? "disconnected" : "checking"}`}>
                      {codexConnected === null ? "Checking..." : codexConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                </div>

                {codexConnected ? (
                  <p className="account-codex-hint">
                    Authenticated via <code>~/.codex/auth.json</code>
                  </p>
                ) : (
                  <div>
                    <p className="account-codex-hint">
                      Codex reads credentials from <code>~/.codex/auth.json</code>.
                      Sign in using the Codex app or CLI:
                    </p>
                    <div className="codex-cli-hint">
                      <code>codex auth</code>
                    </div>
                  </div>
                )}

                <button
                  className="account-text-btn"
                  onClick={recheckCodex}
                  disabled={codexChecking}
                  style={{ marginTop: 8 }}
                >
                  {codexChecking ? "Checking..." : "Recheck status"}
                </button>
              </div>

              {/* Cursor card */}
              <div className="account-card" style={{ marginTop: 10 }}>
                <div className="account-card-header">
                  <div className="account-card-title">
                    <span className="account-provider-name">Cursor</span>
                    <span className={`account-status-badge ${cursorConnected === true ? "connected" : cursorConnected === false ? "disconnected" : "checking"}`}>
                      {cursorConnected === null ? "Checking..." : cursorConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  {cursorEmail && (
                    <p className="account-org-name">{cursorEmail}</p>
                  )}
                </div>

                {cursorConnected ? (
                  <div>
                    <p className="account-codex-hint">Authenticated via:</p>
                    {cursorAuthPath && (
                      <div className="codex-cli-hint">
                        <code style={{ fontSize: 10, color: "var(--blue)", wordBreak: "break-all" }}>
                          {cursorAuthPath}
                        </code>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="account-codex-hint">
                      Cursor stores credentials automatically when you sign in.
                      Open Cursor, log in, then recheck below.
                    </p>
                    {cursorAuthPath && (
                      <div className="codex-cli-hint" style={{ marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Expected at: </span>
                        <code style={{ fontSize: 10, color: "var(--blue)", wordBreak: "break-all" }}>
                          {cursorAuthPath}
                        </code>
                      </div>
                    )}
                    <p className="account-codex-hint" style={{ marginTop: 8 }}>
                      Usage stats for Cursor are not yet available — connection
                      status only for now.
                    </p>
                  </div>
                )}

                <button
                  className="account-text-btn"
                  onClick={recheckCursor}
                  disabled={cursorChecking}
                  style={{ marginTop: 8 }}
                >
                  {cursorChecking ? "Checking..." : "Recheck status"}
                </button>
              </div>

            </div>
          )}

          {/* ── Menu Bar ──────────────────────────────────────── */}
          {activeTab === "menu-bar" && (
            <div className="settings-section">
              <p className="section-hint">Preview of what appears in the tray:</p>
              <div className="tray-preview">{buildPreview()}</div>

              <div className="settings-card">
                <p className="card-label">Show in tray</p>
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

              <div className="form-group">
                <label>Percentage display</label>
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
            </div>
          )}

          {/* ── Provider ──────────────────────────────────────── */}
          {activeTab === "provider" && (
            <div className="settings-section">
              <p className="section-hint">Choose which AI service the tray displays.</p>

              <div className="settings-card">
                <p className="card-label">Mode</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="radio"
                      name="tray-mode"
                      checked={typeof trayConfig.mode === "object" && "Static" in trayConfig.mode}
                      onChange={() =>
                        updateTrayConfig({ mode: { Static: trayConfig.default_provider } })
                      }
                    />
                    Static — always show one provider
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

              {typeof trayConfig.mode === "object" && "Static" in trayConfig.mode && (
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label>Provider</label>
                  <select
                    className="input"
                    value={trayConfig.mode.Static}
                    onChange={(e) =>
                      updateTrayConfig({ mode: { Static: e.target.value as Provider } })
                    }
                  >
                    <option value="Claude">Claude</option>
                    <option value="Codex">Codex</option>
                    <option value="Cursor">Cursor</option>
                  </select>
                </div>
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

                  <div className="settings-card" style={{ marginTop: 4 }}>
                    <p className="card-label">App mappings</p>
                    {trayConfig.app_mappings.length > 0 ? (
                      trayConfig.app_mappings.map((mapping, idx) => (
                        <div className="mapping-row" key={mapping.app_identifier}>
                          <span className="mapping-id">{mapping.app_identifier}</span>
                          <select
                            className="input mapping-select"
                            value={mapping.provider}
                            onChange={(e) => {
                              const updated = [...trayConfig.app_mappings];
                              updated[idx] = { ...mapping, provider: e.target.value as Provider };
                              updateTrayConfig({ app_mappings: updated });
                            }}
                          >
                            <option value="Claude">Claude</option>
                            <option value="Codex">Codex</option>
                            <option value="Cursor">Cursor</option>
                          </select>
                          <button
                            className="icon-btn mapping-remove"
                            onClick={() => {
                              const updated = trayConfig.app_mappings.filter((_, i) => i !== idx);
                              updateTrayConfig({ app_mappings: updated });
                            }}
                          >
                            &#215;
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="form-hint" style={{ marginBottom: 0 }}>
                        No mappings configured.
                      </p>
                    )}

                    <div className="mapping-row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        value={newMappingApp}
                        onChange={(e) => setNewMappingApp(e.target.value)}
                        onFocus={() => {
                          if (runningApps.length === 0) loadRunningApps();
                        }}
                        placeholder="Add app name or process (e.g. Cursor.exe)"
                        list="widget-running-apps"
                      />
                      <datalist id="widget-running-apps">
                        {runningApps
                          .filter(
                            (app) =>
                              !trayConfig.app_mappings.some(
                                (m) => m.app_identifier === app.bundle_id
                              )
                          )
                          .map((app) => (
                            <option key={app.bundle_id} value={app.bundle_id}>
                              {app.name}
                            </option>
                          ))}
                      </datalist>
                      <select
                        className="input mapping-select"
                        value={newMappingProvider}
                        onChange={(e) => setNewMappingProvider(e.target.value as Provider)}
                      >
                        <option value="Claude">Claude</option>
                        <option value="Codex">Codex</option>
                        <option value="Cursor">Cursor</option>
                      </select>
                      <button
                        className="icon-btn"
                        style={{ fontSize: 18, fontWeight: 600 }}
                        disabled={!newMappingApp}
                        onClick={() => {
                          if (!newMappingApp) return;
                          const updated = [
                            ...trayConfig.app_mappings,
                            { app_identifier: newMappingApp, provider: newMappingProvider },
                          ];
                          updateTrayConfig({ app_mappings: updated });
                          setNewMappingApp("");
                          setNewMappingProvider("Claude");
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "widget" && (
            <div className="settings-section">
              <p className="section-hint">Compact provider-specific dashboards shown in the floating widget window.</p>

              <div className="form-group">
                <label>Density</label>
                <select
                  className="input"
                  value={widgetPreferences.density}
                  onChange={(e) => updateWidgetPreferences({ density: e.target.value as WidgetPreferences["density"] })}
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Claude dashboard</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.claude.showExtra ?? false}
                      onChange={(e) => updateWidgetPreferences({ claude: { showExtra: e.target.checked } })}
                    />
                    Show extra usage
                  </label>
                </div>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.claude.showBalance ?? false}
                      onChange={(e) => updateWidgetPreferences({ claude: { showBalance: e.target.checked } })}
                    />
                    Show prepaid balance
                  </label>
                </div>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.claude.showStatus ?? false}
                      onChange={(e) => updateWidgetPreferences({ claude: { showStatus: e.target.checked } })}
                    />
                    Show API status
                  </label>
                </div>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Codex dashboard</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.codex.showCredits ?? false}
                      onChange={(e) => updateWidgetPreferences({ codex: { showCredits: e.target.checked } })}
                    />
                    Show credits
                  </label>
                </div>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.codex.showStatus ?? false}
                      onChange={(e) => updateWidgetPreferences({ codex: { showStatus: e.target.checked } })}
                    />
                    Show API status
                  </label>
                </div>
              </div>

              <div className="settings-card" style={{ marginTop: 10 }}>
                <p className="card-label">Cursor dashboard</p>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widgetPreferences.cursor.showStatus ?? false}
                      onChange={(e) => updateWidgetPreferences({ cursor: { showStatus: e.target.checked } })}
                    />
                    Show API status
                  </label>
                </div>
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

          {/* ── Debug ─────────────────────────────────────────── */}
          {activeTab === "debug" && (
            <div className="settings-section">
              <DebugPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
