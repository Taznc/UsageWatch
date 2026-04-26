// Types mirroring the Rust commands::mcp module. Field names match serde
// camelCase output.

export type McpHost = "claudeDesktop" | "claudeCode" | "cursor" | "codex";

export type McpScope =
  | { kind: "global" }
  | { kind: "project"; path: string };

export interface HostTarget {
  host: McpHost;
  scope: McpScope;
}

export type Transport = "stdio" | "sse" | "http" | "unknown";

export interface McpServerEntry {
  name: string;
  transport: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  raw: unknown;
}

export interface McpHostConfig {
  host: McpHost;
  scope: McpScope;
  path: string;
  detected: boolean;
  readable: boolean;
  enabled: McpServerEntry[];
  disabled: McpServerEntry[];
  error?: string;
}

export type SupportLevel = "native" | "translated" | "unsupported";

export interface WriteOutcome {
  target: HostTarget;
  support: SupportLevel;
  written: boolean;
  note?: string;
}

export interface AddReport {
  outcomes: WriteOutcome[];
}

export interface UnifiedPresence {
  target: HostTarget;
  enabled: boolean;
  entry: McpServerEntry;
}

export interface UnifiedServerView {
  name: string;
  presence: UnifiedPresence[];
}

export interface RestartPromptPayload {
  hosts: McpHost[];
  server: string;
}

export const HOST_LABELS: Record<McpHost, string> = {
  claudeDesktop: "Claude Desktop",
  claudeCode: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
};

export function targetKey(t: HostTarget): string {
  if (t.scope.kind === "global") return `${t.host}::global`;
  return `${t.host}::project::${t.scope.path}`;
}

export function targetLabel(t: HostTarget): string {
  const base = HOST_LABELS[t.host];
  if (t.scope.kind === "global") return base;
  const tail = t.scope.path.split(/[\\/]/).filter(Boolean).pop() ?? t.scope.path;
  return `${base} · ${tail}`;
}
