import type { Provider } from "./usage";

export type CollectionMethod = "browser" | "desktop_app" | "manual";

export interface MethodConfig {
  method: CollectionMethod;
  label: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export const PROVIDER_METHODS: Record<Provider, MethodConfig[]> = {
  Claude: [
    {
      method: "browser",
      label: "Browser Auto-detect",
      description: "Scan installed browsers for a claude.ai session cookie",
      available: true,
    },
    {
      method: "desktop_app",
      label: "Claude Desktop App",
      description: "Read session from the Claude Desktop Electron app",
      available: true,
    },
    {
      method: "manual",
      label: "Manual Entry",
      description: "Paste your session key from DevTools",
      available: true,
    },
  ],
  Codex: [
    {
      method: "desktop_app",
      label: "Desktop Session File",
      description: "Read OAuth tokens from ~/.codex/auth.json",
      available: true,
    },
    {
      method: "browser",
      label: "Browser Cookies",
      description: "Scan installed browsers for a chatgpt.com session cookie",
      available: true,
    },
    {
      method: "manual",
      label: "Manual Entry",
      description: "Paste an access token",
      available: true,
    },
  ],
  Cursor: [
    {
      method: "desktop_app",
      label: "Cursor App Storage",
      description: "Read credentials from Cursor's local auth storage",
      available: true,
    },
    {
      method: "browser",
      label: "Browser Cookies",
      description: "Scan installed browsers for a cursor.com session",
      available: true,
    },
    {
      method: "manual",
      label: "Manual Entry",
      description: "Paste an access token or cookie string",
      available: true,
    },
  ],
};
