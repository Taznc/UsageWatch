import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../../context/AppContext";
import { SettingsSidebar } from "./SettingsSidebar";
import type { SectionId } from "./SettingsSidebar";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { TraySection } from "./sections/TraySection";
import { WidgetSection } from "./sections/WidgetSection";
import { AlertsSection } from "./sections/AlertsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { DebugSection } from "./sections/DebugSection";
import "./Settings.css";

export function Settings2() {
  const { state, dispatch } = useApp();
  const [active, setActive] = useState<SectionId>("connections");

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
          {active === "general"     && <GeneralSection />}
          {active === "debug"       && <DebugSection />}
        </main>
      </div>
    </div>
  );
}
