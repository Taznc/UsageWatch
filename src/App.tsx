import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppProvider, useApp } from "./context/AppContext";
import { Popover } from "./components/Popover";
import { Settings } from "./components/Settings";
import { SetupWizard } from "./components/SetupWizard";
import "./App.css";

function AppContent() {
  const { state, dispatch } = useApp();

  // Check for existing credentials on mount — must run before any view decision
  useEffect(() => {
    async function checkCredentials() {
      try {
        const sessionKey = await invoke<string | null>("get_session_key");
        const orgId = await invoke<string | null>("get_org_id");
        if (sessionKey && orgId) {
          dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
        }
      } catch {
        // No credentials yet
      }
    }
    checkCredentials();
  }, [dispatch]);

  switch (state.view) {
    case "setup":
      return <SetupWizard />;
    case "settings":
      return <Settings />;
    case "popover":
    default:
      return <Popover />;
  }
}

function App() {
  return (
    <AppProvider>
      <div className="app">
        <AppContent />
      </div>
    </AppProvider>
  );
}

export default App;
