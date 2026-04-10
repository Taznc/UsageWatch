import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../context/AppContext";
import { formatPollInterval } from "../utils/format";
import { DebugPanel } from "./DebugPanel";
import type { Organization } from "../types/usage";

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
            <h3 style={{ fontSize: 13, marginBottom: 8 }}>Debug</h3>
            <DebugPanel />
          </div>
        )}
      </div>
    </div>
  );
}
