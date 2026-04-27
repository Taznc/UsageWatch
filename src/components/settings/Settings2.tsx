import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../context/AppContext";
import { SettingsSidebar } from "./SettingsSidebar";
import type { SectionId } from "./SettingsSidebar";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { TraySection } from "./sections/TraySection";
import { WidgetSection } from "./sections/WidgetSection";
import { AlertsSection } from "./sections/AlertsSection";
import { McpSection } from "./sections/McpSection";
import { GeneralSection } from "./sections/GeneralSection";
import { DebugSection } from "./sections/DebugSection";
import "./Settings.css";

export function Settings2() {
  const { state, dispatch } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const active = state.settingsSection;
  const setActive = (section: SectionId) => dispatch({ type: "SET_SETTINGS_SECTION", section });

  const { pinned } = state;
  const setPinned = (p: boolean) => dispatch({ type: "SET_PINNED", pinned: p });

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await invoke("refresh_all_providers"); } catch { /* non-critical */ }
    finally { setRefreshing(false); }
  };

  return (
    <div className="settings-shell">
      <div
        className="settings-shell-header"
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("button,a,input,select,textarea")) {
            e.preventDefault();
            getCurrentWindow().startDragging();
          }
        }}
      >
        <button
          className="s-back-btn"
          onClick={() => dispatch({ type: "SET_VIEW", view: "popover" })}
          aria-label="Back to main view"
        >
          ←
        </button>
        <span className="s-title">Settings</span>
        <div className="s-header-actions">
          <button
            className={`icon-btn pin-btn ${pinned ? "active" : ""}`}
            onClick={() => setPinned(!pinned)}
            title={pinned ? "Unpin window" : "Pin window (keep open)"}
          >
            &#x1F4CC;
          </button>
          <button
            className="icon-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh all providers"
          >
            <span className={refreshing ? "spin" : ""}>&#x21bb;</span>
          </button>
          <button
            className="icon-btn close-btn"
            onClick={() => getCurrentWindow().hide()}
            title="Close"
          >
            &#x2715;
          </button>
        </div>
      </div>

      <div className="settings-shell-body">
        <SettingsSidebar active={active} onSelect={setActive} />

        <main className="settings-panel">
          {!state.hasCredentials && active === "connections" && (
            <div className="s-onboarding-banner">
              <p>Connect at least one provider to start seeing tray and widget data.</p>
            </div>
          )}
          {active === "connections" && <ConnectionsSection />}
          {active === "tray"        && <TraySection />}
          {active === "widget"      && <WidgetSection />}
          {active === "alerts"      && <AlertsSection />}
          {active === "mcp"         && <McpSection />}
          {active === "general"     && <GeneralSection />}
          {active === "debug"       && <DebugSection />}
        </main>
      </div>
    </div>
  );
}
