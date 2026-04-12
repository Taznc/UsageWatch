import type { Provider } from "./usage";

export interface APIStatusResponse {
  status: {
    indicator: string;
    description: string;
  };
}

export interface APIStatus {
  indicator: string;
  description: string;
}

export interface ProviderWidgetPreferences {
  showExtra?: boolean;
  showBalance?: boolean;
  showCredits?: boolean;
  showStatus?: boolean;
}

export interface WidgetPreferences {
  density: "compact" | "comfortable";
  claude: ProviderWidgetPreferences;
  codex: ProviderWidgetPreferences;
  cursor: ProviderWidgetPreferences;
}

export const DEFAULT_WIDGET_PREFERENCES: WidgetPreferences = {
  density: "compact",
  claude: {
    showExtra: true,
    showBalance: false,
    showStatus: false,
  },
  codex: {
    showCredits: true,
    showStatus: false,
  },
  cursor: {
    showStatus: false,
  },
};

export interface WidgetLayout {
  version: number;
  position: { x: number; y: number };
  preferences: WidgetPreferences;
}

export interface CompactWidgetCard {
  id: string;
  provider: Provider;
  accent: string;
  badgeText: string;
  title: string;
  primary: string;
  secondary?: string;
  progress?: number | null;
  span?: 1 | 2;
  tone?: "default" | "muted";
}
