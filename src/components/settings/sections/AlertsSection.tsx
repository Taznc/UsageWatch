import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toggle } from "../shared/Toggle";
import { SettingRow } from "../shared/SettingRow";
import { SettingGroup } from "../shared/SettingGroup";
import type { AlertConfig } from "../../../types/usage";

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  session_threshold: 80,
  weekly_threshold: 80,
  burn_rate_mins: 30,
  notify_on_reset: true,
};

export function AlertsSection() {
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_ALERT_CONFIG);

  useEffect(() => {
    invoke<AlertConfig>("get_alert_config").then(setConfig).catch(() => {});
  }, []);

  const update = async (updates: Partial<AlertConfig>) => {
    const next = { ...config, ...updates };
    setConfig(next);
    try { await invoke("set_alert_config", { config: next }); } catch {}
  };

  return (
    <div>
      <SettingGroup>
        <SettingRow label="Enable alerts">
          <Toggle checked={config.enabled} onChange={(v) => update({ enabled: v })} />
        </SettingRow>
      </SettingGroup>

      {config.enabled && (
        <>
          <SettingGroup label="Thresholds">
            <div className="s-row s-row--col">
              <div className="s-row-left" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="s-row-label">Session usage</span>
                  <span className="s-slider-value">
                    {config.session_threshold === 0 ? "Off" : `${config.session_threshold}%`}
                  </span>
                </div>
                <div className="s-row-hint">Alert when session usage exceeds this level</div>
              </div>
              <input
                type="range" min={0} max={100} step={5}
                value={config.session_threshold}
                onChange={(e) => update({ session_threshold: Number(e.target.value) })}
                className="s-slider"
              />
              <div className="s-slider-row"><span>Off</span><span>100%</span></div>
            </div>

            <div className="s-row s-row--col">
              <div className="s-row-left" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="s-row-label">Weekly usage</span>
                  <span className="s-slider-value">
                    {config.weekly_threshold === 0 ? "Off" : `${config.weekly_threshold}%`}
                  </span>
                </div>
                <div className="s-row-hint">Alert when weekly usage exceeds this level</div>
              </div>
              <input
                type="range" min={0} max={100} step={5}
                value={config.weekly_threshold}
                onChange={(e) => update({ weekly_threshold: Number(e.target.value) })}
                className="s-slider"
              />
              <div className="s-slider-row"><span>Off</span><span>100%</span></div>
            </div>

            <div className="s-row s-row--col">
              <div className="s-row-left" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="s-row-label">Burn rate warning</span>
                  <span className="s-slider-value">
                    {config.burn_rate_mins === 0 ? "Off" : `${config.burn_rate_mins}m`}
                  </span>
                </div>
                <div className="s-row-hint">Alert when estimated time-to-limit drops below this</div>
              </div>
              <input
                type="range" min={0} max={120} step={5}
                value={config.burn_rate_mins}
                onChange={(e) => update({ burn_rate_mins: Number(e.target.value) })}
                className="s-slider"
              />
              <div className="s-slider-row"><span>Off</span><span>2h</span></div>
            </div>
          </SettingGroup>

          <SettingGroup label="Notifications">
            <SettingRow
              label="Reset notifications"
              hint="Notify when a usage window resets after heavy use"
            >
              <Toggle
                checked={config.notify_on_reset}
                onChange={(v) => update({ notify_on_reset: v })}
              />
            </SettingRow>
          </SettingGroup>
        </>
      )}
    </div>
  );
}
