import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppProvider, useApp } from "./context/AppContext";
import { Popover } from "./components/Popover";
import { Settings2 as Settings } from "./components/settings/Settings2";
import "./App.css";

function AppContent() {
  const { state, dispatch } = useApp();
  const focusGuard = useRef(false);

  // Check for existing credentials on mount — any connected provider counts
  useEffect(() => {
    async function checkCredentials() {
      try {
        // Claude
        const sessionKey = await invoke<string | null>("get_session_key");
        const orgId = await invoke<string | null>("get_org_id");
        if (sessionKey && orgId) {
          dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
          return;
        }
        // Codex
        const codexOk = await invoke<boolean>("check_codex_auth");
        if (codexOk) {
          dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
          return;
        }
        // Cursor
        const cursorOk = await invoke<boolean>("check_cursor_auth");
        if (cursorOk) {
          dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
          return;
        }
      } catch {
        // No credentials yet
      }
    }
    checkCredentials();
  }, [dispatch]);

  // Guard against spurious focus loss immediately after the window opens
  useEffect(() => {
    const unlisten = listen("window-opened", () => {
      focusGuard.current = true;
      setTimeout(() => { focusGuard.current = false; }, 300);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Hide window on focus loss unless pinned — active for both views
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && !state.pinned && !focusGuard.current) {
        getCurrentWindow().hide();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [state.pinned]);

  switch (state.view) {
    case "settings":
      return <Settings />;
    case "popover":
    default:
      return <Popover />;
  }
}

function App() {
  const appRef = useRef<HTMLDivElement>(null);

  // Retrigger animation each time the window is opened from the tray
  useEffect(() => {
    const unlisten = listen("window-opened", () => {
      const el = appRef.current;
      if (el) {
        el.classList.remove("animate-in");
        // Force reflow to restart animation
        void el.offsetWidth;
        el.classList.add("animate-in");
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <AppProvider>
      <div className="app" ref={appRef}>
        <AppContent />
      </div>
    </AppProvider>
  );
}

export default App;
