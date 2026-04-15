import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../../context/AppContext";
import { Toggle } from "../shared/Toggle";
import { SettingRow } from "../shared/SettingRow";
import { SettingGroup } from "../shared/SettingGroup";
import { formatPollInterval } from "../../../utils/format";

export function GeneralSection() {
  const { state, dispatch } = useApp();
  const { settings } = state;

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
    </div>
  );
}
