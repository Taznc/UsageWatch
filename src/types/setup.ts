import type { Provider } from "./usage";

export type CollectionMethod = "browser" | "desktop_app" | "manual" | "oauth_file";

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
      method: "oauth_file",
      label: "Claude Code CLI",
      description: "Auto-read OAuth token from Claude Code CLI credentials (recommended)",
      available: true,
    },
    {
      method: "browser",
      label: "Browser Scan",
      description: "Search installed browsers and Claude Desktop for a saved session",
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
      label: "Codex Auth File",
      description: "Read OAuth tokens from ~/.codex/auth.json",
      available: true,
    },
    {
      method: "browser",
      label: "Browser Scan",
      description: "Search installed browsers for a saved ChatGPT session",
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
      description: "Read credentials from Cursor's local app storage",
      available: true,
    },
    {
      method: "browser",
      label: "Browser Scan",
      description: "Search installed browsers for a saved Cursor session",
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
