import { useMemo } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  HostTarget,
  McpHostConfig,
  UnifiedServerView,
} from "../../types/mcp";
import { HOST_LABELS, targetKey, targetLabel } from "../../types/mcp";

interface Props {
  hosts: McpHostConfig[];
  unified: UnifiedServerView[];
  onToggle: (server: string, target: HostTarget, enabled: boolean) => void;
  onAddToTarget: (server: string, target: HostTarget) => void;
  onEdit: (serverName: string) => void;
  onRemove: (server: string, target: HostTarget) => void;
}

interface ColumnDef {
  target: HostTarget;
  label: string;
  detected: boolean;
  path: string;
}

export function McpMatrix({
  hosts,
  unified,
  onToggle,
  onAddToTarget,
  onEdit,
  onRemove,
}: Props) {
  const columns: ColumnDef[] = useMemo(
    () =>
      hosts
        .filter((h) => h.detected)
        .map((h) => ({
          target: { host: h.host, scope: h.scope },
          label: targetLabel({ host: h.host, scope: h.scope }),
          detected: h.detected,
          path: h.path,
        })),
    [hosts],
  );

  if (unified.length === 0) {
    return (
      <div className="mcp-empty">
        No MCP servers found in any detected host config.
      </div>
    );
  }

  return (
    <table className="mcp-matrix">
      <thead>
        <tr>
          <th>Server</th>
          {columns.map((c) => (
            <th key={targetKey(c.target)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
                <span>{c.label}</span>
                <button
                  className="mcp-btn subtle"
                  style={{ fontSize: 9, padding: "1px 4px" }}
                  title={c.path}
                  onClick={() =>
                    revealItemInDir(c.path).catch((e) => alert(`Could not open: ${c.path}\n\n${e}`))
                  }
                >
                  Open
                </button>
              </div>
            </th>
          ))}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {unified.map((row) => {
          const transport =
            row.presence[0]?.entry.transport ?? "unknown";
          return (
            <tr key={row.name}>
              <td className="name-cell">
                {row.name}
                <span className="transport-tag">{transport}</span>
              </td>
              {columns.map((c) => {
                const present = row.presence.find(
                  (p) => targetKey(p.target) === targetKey(c.target),
                );

                // ── Not in this host's config at all ──────────────────────
                if (!present) {
                  return (
                    <td key={targetKey(c.target)} className="matrix-cell matrix-cell--absent">
                      <button
                        className="matrix-add-btn"
                        title={`Add to ${HOST_LABELS[c.target.host]}`}
                        onClick={() => onAddToTarget(row.name, c.target)}
                      >
                        + Add
                      </button>
                    </td>
                  );
                }

                // ── In config — enabled or disabled ───────────────────────
                return (
                  <td key={targetKey(c.target)} className="matrix-cell">
                    <button
                      className={`matrix-toggle ${present.enabled ? "matrix-toggle--on" : "matrix-toggle--off"}`}
                      title={present.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
                      onClick={() => onToggle(row.name, c.target, !present.enabled)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (window.confirm(`Remove "${row.name}" from ${HOST_LABELS[c.target.host]}?`)) {
                          onRemove(row.name, c.target);
                        }
                      }}
                    >
                      <span className="matrix-toggle__track">
                        <span className="matrix-toggle__knob" />
                      </span>
                      <span className="matrix-toggle__label">
                        {present.enabled ? "On" : "Off"}
                      </span>
                    </button>
                  </td>
                );
              })}
              <td>
                <div className="mcp-row-actions">
                  <button
                    className="mcp-btn subtle"
                    onClick={() => onEdit(row.name)}
                  >
                    Edit
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
