// Picker shown when clicking "+ Add server" or "+ Add first server".
// Offers two paths:
//   1. Copy an existing server from any other detected host
//   2. Define a brand-new server (opens McpServerEditor)

import type { HostTarget, McpHostConfig, McpServerEntry } from "../../types/mcp";
import { HOST_LABELS, targetKey } from "../../types/mcp";

const APP_ICONS: Record<string, string> = {
  claudeDesktop: "🟣",
  claudeCode:    "🖥️",
  cursor:        "🔵",
  codex:         "🟢",
};

function serverSummary(e: McpServerEntry): string {
  if (e.command) {
    const s = [e.command, ...(e.args ?? [])].join(" ");
    return s.length > 64 ? s.slice(0, 62) + "…" : s;
  }
  if (e.url) return e.url;
  return e.transport;
}

interface ExistingServer {
  entry: McpServerEntry;
  sourceTarget: HostTarget;
  enabled: boolean;
}

interface Props {
  /** The destination target this picker is adding to. */
  dest: HostTarget;
  /** All hosts — used to build the "copy from" list. */
  hosts: McpHostConfig[];
  onCopy: (server: string, from: HostTarget, to: HostTarget) => Promise<void>;
  onNew: () => void;
  onClose: () => void;
}

export function McpAddPicker({ dest, hosts, onCopy, onNew, onClose }: Props) {
  const destKey = targetKey(dest);

  // Collect all servers that exist on any host OTHER than the destination.
  const candidates: ExistingServer[] = [];
  const seen = new Set<string>(); // deduplicate by server name across sources

  for (const h of hosts) {
    if (!h.detected) continue;
    const t: HostTarget = { host: h.host, scope: h.scope };
    if (targetKey(t) === destKey) continue;

    for (const e of h.enabled) {
      if (!seen.has(e.name)) {
        seen.add(e.name);
        candidates.push({ entry: e, sourceTarget: t, enabled: true });
      }
    }
    for (const e of h.disabled) {
      if (!seen.has(e.name)) {
        seen.add(e.name);
        candidates.push({ entry: e, sourceTarget: t, enabled: false });
      }
    }
  }

  candidates.sort((a, b) => a.entry.name.localeCompare(b.entry.name));

  return (
    <div className="mcp-modal-backdrop" onClick={onClose}>
      <div className="mcp-modal mcp-add-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Add MCP server</h3>

        {/* ── New server ─────────────────────────────────────── */}
        <button className="mcp-picker-new-btn" onClick={onNew}>
          <span className="mcp-picker-new-btn__icon">＋</span>
          <div>
            <div className="mcp-picker-new-btn__label">New server</div>
            <div className="mcp-picker-new-btn__desc">
              Define a command, URL, or connection from scratch
            </div>
          </div>
        </button>

        {/* ── Copy existing ──────────────────────────────────── */}
        {candidates.length > 0 && (
          <>
            <div className="mcp-picker-divider">
              <span>or copy from another app</span>
            </div>

            <div className="mcp-picker-list">
              {candidates.map(({ entry, sourceTarget, enabled }) => {
                const icon = APP_ICONS[sourceTarget.host] ?? "•";
                const hostLabel = HOST_LABELS[sourceTarget.host];
                const scopeTag =
                  sourceTarget.scope.kind === "project"
                    ? ` · ${sourceTarget.scope.path.split(/[\\/]/).pop()}`
                    : "";
                return (
                  <button
                    key={`${sourceTarget.host}-${entry.name}`}
                    className="mcp-picker-row"
                    onClick={() => onCopy(entry.name, sourceTarget, dest)}
                    title={`Copy from ${hostLabel}${scopeTag}`}
                  >
                    <div className="mcp-picker-row__left">
                      <span className="mcp-picker-row__name">{entry.name}</span>
                      <span className="mcp-picker-row__summary">
                        {serverSummary(entry)}
                      </span>
                    </div>
                    <div className="mcp-picker-row__right">
                      {!enabled && (
                        <span className="mcp-picker-row__disabled-tag">disabled</span>
                      )}
                      <span className="mcp-picker-row__source">
                        {icon} {hostLabel}{scopeTag}
                      </span>
                      <span className="mcp-transport">{entry.transport}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="mcp-actions">
          <button className="mcp-btn subtle" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
