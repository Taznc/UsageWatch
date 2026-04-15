import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../../context/AppContext";
import { Toggle } from "../shared/Toggle";
import { SettingRow } from "../shared/SettingRow";
import { SettingGroup } from "../shared/SettingGroup";
import { formatPollInterval } from "../../../utils/format";

export function GeneralSection() {
  const { state, dispatch } = useApp();
  const { settings } = state;
  const [httpServerEnabled, setHttpServerEnabled] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_http_server_enabled")
      .then(setHttpServerEnabled)
      .catch(() => {});
  }, []);

  const updatePollInterval = async (secs: number) => {
    dispatch({ type: "UPDATE_SETTINGS", settings: { poll_interval_secs: secs } });
    try { await invoke("set_poll_interval", { interval: secs }); } catch {}
  };

  return (
    <div>
      <SettingGroup label="Display">
        <SettingRow
          label="Show remaining %"
          hint="Show remaining instead of used percentages"
        >
          <Toggle
            checked={settings.show_remaining}
            onChange={(v) =>
              dispatch({ type: "UPDATE_SETTINGS", settings: { show_remaining: v } })
            }
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Polling">
        <div className="s-row s-row--col">
          <div className="s-row-left" style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="s-row-label">Refresh interval</span>
              <span className="s-slider-value">{formatPollInterval(settings.poll_interval_secs)}</span>
            </div>
          </div>
          <input
            type="range" min={30} max={300} step={10}
            value={settings.poll_interval_secs}
            onChange={(e) => updatePollInterval(Number(e.target.value))}
            className="s-slider"
          />
          <div className="s-slider-row"><span>30s</span><span>5m</span></div>
        </div>
      </SettingGroup>

      <SettingGroup label="Startup">
        <SettingRow label="Launch at login">
          <Toggle
            checked={settings.autostart}
            onChange={(v) =>
              dispatch({ type: "UPDATE_SETTINGS", settings: { autostart: v } })
            }
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Local API server">
        <SettingRow
          label="Enable local API server"
          hint="Serves usage data on port 52700 for MCP and Stream Deck integrations. Changes take effect on next launch."
        >
          <Toggle
            checked={httpServerEnabled}
            onChange={async (enabled) => {
              setHttpServerEnabled(enabled);
              try {
                await invoke("set_http_server_enabled", { enabled });
              } catch {
                setHttpServerEnabled(!enabled);
              }
            }}
          />
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
