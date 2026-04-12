import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { BillingInfo, CodexUsageData, CursorUsageData, Provider, UsageData } from "../types/usage";
import type { APIStatus, WidgetLayout } from "../types/widget";
import { DEFAULT_WIDGET_PREFERENCES } from "../types/widget";
import {
  isTauriRuntime,
  previewBillingData,
  previewCodexData,
  previewCursorData,
  previewStatus,
  previewUsageData,
} from "../widget/preview";

interface WidgetState {
  usageData: UsageData | null;
  codexData: CodexUsageData | null;
  cursorData: CursorUsageData | null;
  billingData: BillingInfo | null;
  status: APIStatus | null;
  activeProvider: Provider;
  layout: WidgetLayout;
}

type WidgetAction =
  | { type: "SET_USAGE"; data: UsageData }
  | { type: "SET_CODEX"; data: CodexUsageData }
  | { type: "SET_CURSOR"; data: CursorUsageData }
  | { type: "SET_BILLING"; data: BillingInfo }
  | { type: "SET_STATUS"; data: APIStatus }
  | { type: "SET_ACTIVE_PROVIDER"; provider: Provider }
  | { type: "SET_LAYOUT"; layout: WidgetLayout };

const defaultLayout: WidgetLayout = {
  version: 1,
  position: { x: 200, y: 100 },
  preferences: DEFAULT_WIDGET_PREFERENCES,
};

const initialState: WidgetState = {
  usageData: isTauriRuntime() ? null : previewUsageData,
  codexData: isTauriRuntime() ? null : previewCodexData,
  cursorData: isTauriRuntime() ? null : previewCursorData,
  billingData: isTauriRuntime() ? null : previewBillingData,
  status: isTauriRuntime() ? null : previewStatus,
  activeProvider: "Claude",
  layout: defaultLayout,
};

function reducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case "SET_USAGE":
      return { ...state, usageData: action.data };
    case "SET_CODEX":
      return { ...state, codexData: action.data };
    case "SET_CURSOR":
      return { ...state, cursorData: action.data };
    case "SET_BILLING":
      return { ...state, billingData: action.data };
    case "SET_STATUS":
      return { ...state, status: action.data };
    case "SET_ACTIVE_PROVIDER":
      return { ...state, activeProvider: action.provider };
    case "SET_LAYOUT":
      return { ...state, layout: action.layout };
    default:
      return state;
  }
}

interface WidgetContextValue {
  state: WidgetState;
  dispatch: React.Dispatch<WidgetAction>;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

export function WidgetProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <WidgetContext.Provider value={{ state, dispatch }}>
      {children}
    </WidgetContext.Provider>
  );
}

export function useWidget() {
  const ctx = useContext(WidgetContext);
  if (!ctx) throw new Error("useWidget must be used inside WidgetProvider");
  return ctx;
}
