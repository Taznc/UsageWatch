import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { HostTarget, McpHost, McpHostConfig, McpScope } from "../../types/mcp";
import { targetLabel } from "../../types/mcp";

function openConfig(path: string, detected: boolean) {
  const target = detected
    ? path
    : path.replace(/[\\/][^\\/]+$/, "") || path;
  revealItemInDir(target).catch((e) => {
    alert(`Could not open: ${target}\n\n${e}`);
  });
}

function isProject(scope: McpScope) {
  return scope.kind === "project";
}

interface Props {
  hosts: McpHostConfig[];
  running: McpHost[];
  onToggle: (server: string, target: HostTarget, enabled: boolean) => void;
  onRemove: (server: string, target: HostTarget) => void;
  onRestart: (host: McpHost) => void;
  onAddServer: (target: HostTarget) => void;
}

export function McpHostList({ hosts, running, onToggle, onRemove, onRestart, onAddServer }: Props) {
  if (hosts.length === 0) {
    return <div className="mcp-empty">No host configs detected.</div>;
  }

  // Show all hosts — including project ones where the config file doesn't exist yet
  return (
    <div>
      {hosts.map((h) => {
        const target: HostTarget = { host: h.host, scope: h.scope };
        const isRunning = running.includes(h.host);
        const proj = isProject(h.scope);
        return (
          <div className="mcp-host-card" key={`${h.host}-${h.path}`}>
            <div className="mcp-host-card-head">
              <h4>{targetLabel(target)}</h4>
              <button
                className="mcp-btn subtle"
                onClick={() => openConfig(h.path, h.detected)}
                title={h.detected ? `Open ${h.path}` : `Open containing folder`}
              >
                Open config
              </button>
              {!proj && isRunning && h.host !== "claudeCode" && (
                <button
                  className="mcp-btn subtle"
                  onClick={() => onRestart(h.host)}
                  title="Restart this host application"
                >
                  Restart
                </button>
              )}
              {!proj && (
                <span className={`mcp-host-status ${isRunning ? "running" : ""}`}>
                  {h.host === "claudeCode"
                    ? "(CLI)"
                    : isRunning
                      ? "● running"
                      : "○ not running"}
                </span>
              )}
            </div>
            <div className="mcp-host-path">{h.path}</div>

            {!h.detected && (
              <div className="mcp-no-config">
                <span>No config file here yet.</span>
                <button
                  className="mcp-btn"
                  onClick={() => onAddServer(target)}
                  title="Add an MCP server — this will create the config file"
                >
                  + Add first server
                </button>
              </div>
            )}

            {h.error && <div className="mcp-error">{h.error}</div>}

            {h.detected && (
              <div style={{ marginTop: 10 }}>
                {[...h.enabled.map((e) => ({ entry: e, enabled: true })),
                  ...h.disabled.map((e) => ({ entry: e, enabled: false }))]
                  .sort((a, b) => a.entry.name.localeCompare(b.entry.name))
                  .map(({ entry, enabled }) => (
                    <div
                      key={entry.name}
                      className={`mcp-server-item ${enabled ? "" : "disabled"}`}
                    >
                      <span className="name">{entry.name}</span>
                      <span className="transport-tag">{entry.transport}</span>
                      <button
                        className={`mcp-cell ${enabled ? "enabled" : "disabled"}`}
                        onClick={() => onToggle(entry.name, target, !enabled)}
                      >
                        {enabled ? "on" : "off"}
                      </button>
                      <button
                        className="mcp-btn subtle"
                        onClick={() => {
                          if (window.confirm(`Remove ${entry.name}?`)) {
                            onRemove(entry.name, target);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                {h.enabled.length === 0 && h.disabled.length === 0 && (
                  <div className="mcp-no-config">
                    <span>No MCP servers in this config yet.</span>
                    <button
                      className="mcp-btn"
                      onClick={() => onAddServer(target)}
                    >
                      + Add first server
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
