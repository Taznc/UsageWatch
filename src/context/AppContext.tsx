import { createContext, useContext, useReducer, ReactNode } from "react";
import type { UsageData, AppSettings, AppView, CodexUsageData, CursorUsageData, PeakHoursStatus } from "../types/usage";

interface AppState {
  view: AppView;
  pinned: boolean;
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
  cursorData: CursorUsageData | null;
  cursorError: string | null;
  cursorLastUpdated: string | null;
  peakHours: PeakHoursStatus | null;
}

type AppAction =
  | { type: "SET_VIEW"; view: AppView }
  | { type: "SET_PINNED"; pinned: boolean }
  | { type: "SET_USAGE"; data: UsageData; timestamp: string; peakHours?: PeakHoursStatus | null }
  | { type: "SET_ERROR"; error: string; timestamp: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_OFFLINE"; offline: boolean }
  | { type: "SET_HAS_CREDENTIALS"; has: boolean }
  | { type: "UPDATE_SETTINGS"; settings: Partial<AppSettings> }
  | { type: 'SET_CODEX'; data: CodexUsageData; timestamp: string }
  | { type: 'SET_CODEX_ERROR'; error: string; timestamp: string }
  | { type: 'SET_CURSOR'; data: CursorUsageData; timestamp: string }
  | { type: 'SET_CURSOR_ERROR'; error: string; timestamp: string };

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
  view: "popover",
  pinned: true,
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
  cursorData: null,
  cursorError: null,
  cursorLastUpdated: null,
  peakHours: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "SET_PINNED":
      return { ...state, pinned: action.pinned };
    case "SET_USAGE":
      return {
        ...state,
        usageData: action.data,
        lastUpdated: action.timestamp,
        error: null,
        isLoading: false,
        peakHours: action.peakHours ?? state.peakHours,
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
        view: action.has ? state.view : "settings",
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
    case 'SET_CURSOR':
      return { ...state, cursorData: action.data, cursorError: null, cursorLastUpdated: action.timestamp };
    case 'SET_CURSOR_ERROR':
      return { ...state, cursorError: action.error, cursorLastUpdated: action.timestamp };
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
