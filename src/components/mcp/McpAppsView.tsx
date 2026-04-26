import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { HostTarget, McpHost, McpHostConfig, McpServerEntry } from "../../types/mcp";
import { HOST_LABELS } from "../../types/mcp";

// ── Helpers ───────────────────────────────────────────────────────────────

const APP_ICONS: Record<McpHost, string> = {
  claudeDesktop: "🟣",
  claudeCode:    "🖥️",
  cursor:        "🔵",
  codex:         "🟢",
};

/** One-line summary of what a server does */
function serverSummary(entry: McpServerEntry): string {
  if (entry.command) {
    const parts = [entry.command, ...(entry.args ?? [])].join(" ");
    return parts.length > 72 ? parts.slice(0, 70) + "…" : parts;
  }
  if (entry.url) return entry.url;
  return entry.transport;
}

function openFile(path: string, exists: boolean) {
  // revealItemInDir highlights the file in Explorer / Finder.
  // When the file doesn't exist yet, reveal the parent folder instead.
  const target = exists ? path : path.replace(/[\\/][^\\/]+$/, "") || path;
  revealItemInDir(target).catch((e) => {
    // Surface the error so it's visible rather than silently swallowed.
    alert(`Could not open: ${target}\n\n${e}`);
  });
}

// ── Sub-components ────────────────────────────────────────────────────────

interface ServerRowProps {
  entry: McpServerEntry;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

function ServerRow({ entry, enabled, onToggle, onRemove }: ServerRowProps) {
  return (
    <div className={`mav-server-row ${enabled ? "" : "mav-server-row--off"}`}>
      <div className="mav-server-row__left">
        <span className="mav-server-row__name">{entry.name}</span>
        <span className="mav-server-row__summary">{serverSummary(entry)}</span>
      </div>
      <div className="mav-server-row__right">
        <span className="mav-transport">{entry.transport}</span>
        <button
          className={`mav-toggle ${enabled ? "mav-toggle--on" : "mav-toggle--off"}`}
          onClick={onToggle}
          title={enabled ? "Disable this server" : "Enable this server"}
        >
          <span className="mav-toggle__knob" />
        </button>
        <button
          className="mav-remove-btn"
          onClick={onRemove}
          title={`Remove ${entry.name}`}
          aria-label={`Remove ${entry.name}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface AppBlockProps {
  host: McpHost;
  config: McpHostConfig | undefined;
  running: boolean;
  onToggle: (server: string, target: HostTarget, enabled: boolean) => void;
  onRemove: (server: string, target: HostTarget) => void;
  onRestart: (host: McpHost) => void;
  onAddServer: (target: HostTarget) => void;
  scopeLabel?: string;  // e.g. "global" or project folder name
}

function AppBlock({
  host,
  config,
  running,
  onToggle,
  onRemove,
  onRestart,
  onAddServer,
  scopeLabel,
}: AppBlockProps) {
  const scope = config?.scope ?? { kind: "global" as const };
  const target: HostTarget = { host, scope };
  const exists = config?.detected ?? false;
  const path = config?.path ?? "";

  const servers: { entry: McpServerEntry; enabled: boolean }[] = config
    ? [
        ...config.enabled.map((e) => ({ entry: e, enabled: true })),
        ...config.disabled.map((e) => ({ entry: e, enabled: false })),
      ].sort((a, b) => a.entry.name.localeCompare(b.entry.name))
    : [];

  return (
    <div className={`mav-app-block ${exists ? "" : "mav-app-block--absent"}`}>
      {/* ── App header ── */}
      <div className="mav-app-header">
        <span className="mav-app-icon">{APP_ICONS[host]}</span>
        <div className="mav-app-header__info">
          <span className="mav-app-name">
            {HOST_LABELS[host]}
            {scopeLabel && <span className="mav-scope-badge">{scopeLabel}</span>}
          </span>
          {path && (
            <span className="mav-app-path" title={path}>
              {path}
            </span>
          )}
        </div>
        <div className="mav-app-header__actions">
          {exists && path && (
            <button
              className="mav-action-btn"
              onClick={() => openFile(path, exists)}
              title={`Show in Explorer: ${path}`}
            >
              Reveal
            </button>
          )}
          {!exists && path && (
            <button
              className="mav-action-btn mav-action-btn--dim"
              onClick={() => openFile(path, false)}
              title="Open containing folder in Explorer"
            >
              Open folder
            </button>
          )}
          {running && host !== "claudeCode" && (
            <button
              className="mav-action-btn mav-action-btn--restart"
              onClick={() => onRestart(host)}
              title="Restart the application so config changes take effect"
            >
              Restart
            </button>
          )}
          <span className={`mav-status-pill ${running ? "mav-status-pill--on" : ""}`}>
            {host === "claudeCode"
              ? "CLI"
              : running
              ? "Running"
              : "Not running"}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      {config?.error && (
        <div className="mav-alert mav-alert--error">
          Could not read config: {config.error}
        </div>
      )}

      {!exists && !config?.error && (
        <div className="mav-absent-body">
          <span>No config file found at the path above.</span>
          <button
            className="mav-cta-btn"
            onClick={() => onAddServer(target)}
          >
            + Add first server
          </button>
        </div>
      )}

      {exists && servers.length === 0 && !config?.error && (
        <div className="mav-absent-body">
          <span>No MCP servers configured.</span>
          <button
            className="mav-cta-btn"
            onClick={() => onAddServer(target)}
          >
            + Add server
          </button>
        </div>
      )}

      {exists && servers.length > 0 && (
        <div className="mav-server-list">
          <div className="mav-server-list__header">
            <span>Server</span>
            <span>Command / URL</span>
            <span style={{ marginLeft: "auto" }}>Enabled</span>
          </div>
          {servers.map(({ entry, enabled }) => (
            <ServerRow
              key={entry.name}
              entry={entry}
              enabled={enabled}
              onToggle={() => onToggle(entry.name, target, !enabled)}
              onRemove={() => {
                if (window.confirm(`Remove "${entry.name}" from ${HOST_LABELS[host]}?`)) {
                  onRemove(entry.name, target);
                }
              }}
            />
          ))}
          <div className="mav-server-list__footer">
            <button
              className="mav-action-btn"
              onClick={() => onAddServer(target)}
            >
              + Add server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

const GLOBAL_HOSTS: McpHost[] = ["claudeDesktop", "claudeCode", "cursor", "codex"];

interface Props {
  hosts: McpHostConfig[];
  running: McpHost[];
  onToggle: (server: string, target: HostTarget, enabled: boolean) => void;
  onRemove: (server: string, target: HostTarget) => void;
  onRestart: (host: McpHost) => void;
  onAddServer: (target: HostTarget) => void;
}

export function McpAppsView({
  hosts,
  running,
  onToggle,
  onRemove,
  onRestart,
  onAddServer,
}: Props) {
  const globalConfigs = hosts.filter((h) => h.scope.kind === "global");
  const projectConfigs = hosts.filter((h) => h.scope.kind === "project");

  // Group project configs by project root path
  const projectRoots = Array.from(
    new Set(
      projectConfigs
        .map((h) => (h.scope.kind === "project" ? h.scope.path : null))
        .filter(Boolean) as string[],
    ),
  );

  return (
    <div className="mav-shell">

      {/* ── Section: Global AI apps ── */}
      <section className="mav-section">
        <div className="mav-section-header">
          <h3 className="mav-section-title">Global AI Apps</h3>
          <p className="mav-section-desc">
            MCP servers configured here are available every time you open the app.
          </p>
        </div>

        <div className="mav-app-list">
          {GLOBAL_HOSTS.map((host) => {
            const config = globalConfigs.find((h) => h.host === host);
            return (
              <AppBlock
                key={host}
                host={host}
                config={config}
                running={running.includes(host)}
                onToggle={onToggle}
                onRemove={onRemove}
                onRestart={onRestart}
                onAddServer={onAddServer}
              />
            );
          })}
        </div>
      </section>

      {/* ── Section: Project configs ── */}
      {projectRoots.length > 0 && (
        <section className="mav-section">
          <div className="mav-section-header">
            <h3 className="mav-section-title">Project Configs</h3>
            <p className="mav-section-desc">
              Servers scoped to a specific project folder. Changes only affect that project's{" "}
              <code>.mcp.json</code> / <code>.cursor/mcp.json</code>.
            </p>
          </div>

          {projectRoots.map((rootPath) => {
            const folderName = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
            const projectHosts = projectConfigs.filter(
              (h) => h.scope.kind === "project" && h.scope.path === rootPath,
            );

            return (
              <div key={rootPath} className="mav-project-group">
                <div className="mav-project-group__heading">
                  <span className="mav-project-group__icon">📁</span>
                  <span className="mav-project-group__name">{folderName}</span>
                  <span className="mav-project-group__path" title={rootPath}>{rootPath}</span>
                </div>
                <div className="mav-app-list mav-app-list--inset">
                  {(["claudeCode", "cursor"] as McpHost[]).map((host) => {
                    const config = projectHosts.find((h) => h.host === host);
                    return (
                      <AppBlock
                        key={host}
                        host={host}
                        config={config}
                        running={running.includes(host)}
                        onToggle={onToggle}
                        onRemove={onRemove}
                        onRestart={onRestart}
                        onAddServer={onAddServer}
                        scopeLabel={folderName}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
