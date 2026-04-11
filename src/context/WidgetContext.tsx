import { createContext, useContext, useReducer, ReactNode } from "react";
import type { UsageData, CodexUsageData, BillingInfo } from "../types/usage";
import type { WidgetLayout, APIStatus, TileId } from "../types/widget";
import { DEFAULT_TILES } from "../types/widget";

interface WidgetState {
  usageData: UsageData | null;
  codexData: CodexUsageData | null;
  billingData: BillingInfo | null;
  status: APIStatus | null;
  layout: WidgetLayout;
  isEditMode: boolean;
}

type WidgetAction =
  | { type: "SET_USAGE"; data: UsageData }
  | { type: "SET_CODEX"; data: CodexUsageData }
  | { type: "SET_BILLING"; data: BillingInfo }
  | { type: "SET_STATUS"; data: APIStatus }
  | { type: "SET_LAYOUT"; layout: WidgetLayout }
  | { type: "SET_PLACED_TILES"; tiles: TileId[] }
  | { type: "TOGGLE_EDIT" }
  | { type: "EXIT_EDIT" };

const defaultLayout: WidgetLayout = {
  version: 1,
  placedTiles: DEFAULT_TILES,
  position: { x: 200, y: 100 },
};

const initialState: WidgetState = {
  usageData: null,
  codexData: null,
  billingData: null,
  status: null,
  layout: defaultLayout,
  isEditMode: false,
};

function reducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case "SET_USAGE":
      return { ...state, usageData: action.data };
    case "SET_CODEX":
      return { ...state, codexData: action.data };
    case "SET_BILLING":
      return { ...state, billingData: action.data };
    case "SET_STATUS":
      return { ...state, status: action.data };
    case "SET_LAYOUT":
      return { ...state, layout: action.layout };
    case "SET_PLACED_TILES":
      return { ...state, layout: { ...state.layout, placedTiles: action.tiles } };
    case "TOGGLE_EDIT":
      return { ...state, isEditMode: !state.isEditMode };
    case "EXIT_EDIT":
      return { ...state, isEditMode: false };
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
