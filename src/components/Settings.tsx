import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../context/AppContext";
import { formatPollInterval } from "../utils/format";
import { DebugPanel } from "./DebugPanel";
import type { Organization, TrayFormat, TrayConfig, RunningApp, Provider } from "../types/usage";

export function Settings() {
  const { state, dispatch } = useApp();
  const { settings } = state;

  const [sessionKey, setSessionKey] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("credentials");
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
    ],
    default_provider: "Claude",
  });
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [newMappingApp, setNewMappingApp] = useState("");
  const [newMappingProvider, setNewMappingProvider] = useState<Provider>("Claude");

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
    loadTrayFormat();
    loadTrayConfig();
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

  const loadRunningApps = async () => {
    try {
      const apps = await invoke<RunningApp[]>("get_running_apps");
      setRunningApps(apps.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {}
  };

  // Build preview of what the menu bar will look like
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
      } catch {}
    }
    loadCredentials();
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
      setSaveStatus("Connection successful! Key saved.");
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

  const tabs = [
    { id: "credentials", label: "Credentials" },
    { id: "behavior", label: "Behavior" },
    { id: "tray-source", label: "Source" },
    { id: "notifications", label: "Notifications" },
    { id: "appearance", label: "Appearance" },
  ];

  return (
    <div className="settings">
      <div className="settings-header" onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, input, select")) {
          e.preventDefault();
          getCurrentWindow().startDragging();
        }
      }}>
        <button
          className="icon-btn back-btn"
          onClick={() => dispatch({ type: "SET_VIEW", view: "popover" })}
        >
          &#x2190;
        </button>
        <h2>Settings</h2>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === "credentials" && (
          <div className="settings-section">
            <button
              className="btn primary full-width"
              onClick={async () => {
                setScanning(true);
                setError("");
                setSaveStatus("");
                try {
                  const results = await invoke<{ browser: string; session_key: string | null }[]>("pull_session_from_browsers");
                  const found = results.find(r => r.session_key);
                  if (found?.session_key) {
                    setSessionKey(found.session_key);
                    setSaveStatus(`Found in ${found.browser}! Click Test & Save.`);
                  } else {
                    setError("No session found in any browser.");
                  }
                } catch (e: any) {
                  setError(String(e));
                } finally {
                  setScanning(false);
                }
              }}
              disabled={scanning}
            >
              {scanning ? "Scanning..." : "Auto-detect from Browser"}
            </button>

            <div className="divider"><span>or enter manually</span></div>

            <div className="form-group">
              <label htmlFor="settings-key">Session Key</label>
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
              disabled={testing}
              style={{ marginBottom: 14 }}
            >
              {testing ? "Testing..." : "Test & Save"}
            </button>

            {orgs.length > 0 && (
              <div className="form-group">
                <label htmlFor="settings-org">Organization</label>
                <select
                  id="settings-org"
                  value={orgId}
                  onChange={(e) => saveOrg(e.target.value)}
                  className="input"
                >
                  <option value="">Select...</option>
                  {orgs.map((org) => (
                    <option key={org.uuid} value={org.uuid}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {saveStatus && <div className="form-success">{saveStatus}</div>}
            {error && <div className="form-error">{error}</div>}
          </div>
        )}

        {activeTab === "behavior" && (
          <div className="settings-section">
            <div className="form-group">
              <label>
                Poll Interval: {formatPollInterval(settings.poll_interval_secs)}
              </label>
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

            <div className="form-group toggle-group">
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
        )}

        {activeTab === "tray-source" && (
          <div className="settings-section">
            <h3 style={{ fontSize: 13, marginBottom: 12 }}>Mode</h3>
            <div className="form-group toggle-group">
              <label>
                <input
                  type="radio"
                  name="tray-mode"
                  checked={typeof trayConfig.mode === "object" && "Static" in trayConfig.mode}
                  onChange={() => updateTrayConfig({ mode: { Static: trayConfig.default_provider } })}
                />
                Static (always show one provider)
              </label>
            </div>
            <div className="form-group toggle-group">
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
                Dynamic (switch based on focused app)
              </label>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

            {typeof trayConfig.mode === "object" && "Static" in trayConfig.mode && (
              <>
                <h3 style={{ fontSize: 13, marginBottom: 12 }}>Provider</h3>
                <div className="form-group">
                  <select
                    className="input"
                    value={trayConfig.mode.Static}
                    onChange={(e) => updateTrayConfig({ mode: { Static: e.target.value as Provider } })}
                  >
                    <option value="Claude">Claude</option>
                    <option value="Codex">Codex</option>
                  </select>
                </div>
              </>
            )}

            {trayConfig.mode === "Dynamic" && (
              <>
                <h3 style={{ fontSize: 13, marginBottom: 12 }}>Default Provider</h3>
                <div className="form-group">
                  <label>Shown when no app mapping matches</label>
                  <select
                    className="input"
                    value={trayConfig.default_provider}
                    onChange={(e) => updateTrayConfig({ default_provider: e.target.value as Provider })}
                  >
                    <option value="Claude">Claude</option>
                    <option value="Codex">Codex</option>
                  </select>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

                <h3 style={{ fontSize: 13, marginBottom: 12 }}>App Mappings</h3>

                {trayConfig.app_mappings.length > 0 ? (
                  trayConfig.app_mappings.map((mapping, idx) => (
                    <div className="form-group" key={mapping.app_identifier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {mapping.app_identifier}
                      </span>
                      <select
                        className="input"
                        style={{ width: "auto", flex: "0 0 auto" }}
                        value={mapping.provider}
                        onChange={(e) => {
                          const updated = [...trayConfig.app_mappings];
                          updated[idx] = { ...mapping, provider: e.target.value as Provider };
                          updateTrayConfig({ app_mappings: updated });
                        }}
                      >
                        <option value="Claude">Claude</option>
                        <option value="Codex">Codex</option>
                      </select>
                      <button
                        className="icon-btn"
                        style={{ fontSize: 16, padding: "2px 6px" }}
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
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
                    No app mappings configured.
                  </p>
                )}

                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

                <h3 style={{ fontSize: 13, marginBottom: 12 }}>Add Mapping</h3>
                <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    className="input"
                    style={{ flex: 1 }}
                    value={newMappingApp}
                    onChange={(e) => setNewMappingApp(e.target.value)}
                    onFocus={() => {
                      if (runningApps.length === 0) loadRunningApps();
                    }}
                  >
                    <option value="">Select app...</option>
                    {runningApps
                      .filter((app) => !trayConfig.app_mappings.some((m) => m.app_identifier === app.bundle_id))
                      .map((app) => (
                        <option key={app.bundle_id} value={app.bundle_id}>
                          {app.name} ({app.bundle_id})
                        </option>
                      ))}
                  </select>
                  <select
                    className="input"
                    style={{ width: "auto", flex: "0 0 auto" }}
                    value={newMappingProvider}
                    onChange={(e) => setNewMappingProvider(e.target.value as Provider)}
                  >
                    <option value="Claude">Claude</option>
                    <option value="Codex">Codex</option>
                  </select>
                  <button
                    className="btn primary"
                    style={{ padding: "4px 10px", fontSize: 16 }}
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
              </>
            )}
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="settings-section">
            <div className="form-group toggle-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.notifications_enabled}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_SETTINGS",
                      settings: { notifications_enabled: e.target.checked },
                    })
                  }
                />
                Enable notifications
              </label>
            </div>

            {settings.notifications_enabled && (
              <div className="notification-thresholds">
                <p className="form-hint">Notify when usage reaches:</p>
                {[
                  { key: "notify_at_75" as const, label: "75%" },
                  { key: "notify_at_90" as const, label: "90%" },
                  { key: "notify_at_95" as const, label: "95%" },
                ].map(({ key, label }) => (
                  <div className="form-group toggle-group" key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings[key]}
                        onChange={(e) =>
                          dispatch({
                            type: "UPDATE_SETTINGS",
                            settings: { [key]: e.target.checked },
                          })
                        }
                      />
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "appearance" && (
          <div className="settings-section">
            <div className="form-group toggle-group">
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

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

            <h3 style={{ fontSize: 13, marginBottom: 12 }}>Menu Bar Display</h3>
            <div className="tray-preview">
              {buildPreview()}
            </div>

            <div className="tray-segments">
              {[
                { key: "show_session_pct" as const, label: "Session %" },
                { key: "show_session_timer" as const, label: "Session countdown" },
                { key: "show_weekly_pct" as const, label: "Weekly %" },
                { key: "show_weekly_timer" as const, label: "Weekly countdown" },
                { key: "show_sonnet_pct" as const, label: "Sonnet %" },
                { key: "show_opus_pct" as const, label: "Opus %" },
                { key: "show_extra_usage" as const, label: "Extra usage spend" },
              ].map(({ key, label }) => (
                <div className="form-group toggle-group" key={key}>
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

            <div className="form-group">
              <label>Separator</label>
              <select
                className="input"
                value={trayFormat.separator}
                onChange={(e) => updateTrayFormat({ separator: e.target.value })}
              >
                <option value=" | ">Pipe ( | )</option>
                <option value=" · ">Dot ( · )</option>
                <option value="  ">Space</option>
                <option value=" / ">Slash ( / )</option>
              </select>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />
            <h3 style={{ fontSize: 13, marginBottom: 8 }}>Debug</h3>
            <DebugPanel />
          </div>
        )}
      </div>
    </div>
  );
}
