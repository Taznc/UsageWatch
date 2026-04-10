import { AppProvider, useApp } from "./context/AppContext";
import { Popover } from "./components/Popover";
import { Settings } from "./components/Settings";
import { SetupWizard } from "./components/SetupWizard";
import "./App.css";

function AppContent() {
  const { state } = useApp();

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
