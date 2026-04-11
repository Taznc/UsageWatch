import { createContext, useContext, useReducer, ReactNode } from "react";
import type { UsageData, AppSettings, AppView, CodexUsageData } from "../types/usage";

interface AppState {
  view: AppView;
  usageData: UsageData | null;
  lastUpdated: string | null;
  error: string | null;
  isLoading: boolean;
  isOffline: boolean;
  hasCredentials: boolean;
  settings: AppSettings;
  codexData: CodexUsageData | null;
  codexError: string | null;
  codexLastUpdated: string | null;
}

type AppAction =
  | { type: "SET_VIEW"; view: AppView }
  | { type: "SET_USAGE"; data: UsageData; timestamp: string }
  | { type: "SET_ERROR"; error: string; timestamp: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_OFFLINE"; offline: boolean }
  | { type: "SET_HAS_CREDENTIALS"; has: boolean }
  | { type: "UPDATE_SETTINGS"; settings: Partial<AppSettings> }
  | { type: 'SET_CODEX'; data: CodexUsageData; timestamp: string }
  | { type: 'SET_CODEX_ERROR'; error: string; timestamp: string };

const defaultSettings: AppSettings = {
  poll_interval_secs: 60,
  show_remaining: false,
  notifications_enabled: true,
  notify_at_75: true,
  notify_at_90: true,
  notify_at_95: true,
  autostart: false,
};

const initialState: AppState = {
  view: "setup",
  usageData: null,
  lastUpdated: null,
  error: null,
  isLoading: false,
  isOffline: false,
  hasCredentials: false,
  settings: defaultSettings,
  codexData: null,
  codexError: null,
  codexLastUpdated: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "SET_USAGE":
      return {
        ...state,
        usageData: action.data,
        lastUpdated: action.timestamp,
        error: null,
        isLoading: false,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        lastUpdated: action.timestamp,
        isLoading: false,
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.loading };
    case "SET_OFFLINE":
      return { ...state, isOffline: action.offline };
    case "SET_HAS_CREDENTIALS":
      return {
        ...state,
        hasCredentials: action.has,
        view: action.has ? (state.view === "setup" ? "popover" : state.view) : "setup",
      };
    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
      };
    case 'SET_CODEX':
      return { ...state, codexData: action.data, codexError: null, codexLastUpdated: action.timestamp };
    case 'SET_CODEX_ERROR':
      return { ...state, codexError: action.error, codexLastUpdated: action.timestamp };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
