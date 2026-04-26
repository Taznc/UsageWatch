import { useState } from "react";
import type { HostTarget, McpServerEntry } from "../../../types/mcp";
import { useMcpManager } from "../../../hooks/useMcpManager";
import { McpMatrix } from "../../mcp/McpMatrix";
import { McpAppsView } from "../../mcp/McpAppsView";
import { McpServerEditor } from "../../mcp/McpServerEditor";
import { McpAddPicker } from "../../mcp/McpAddPicker";
import { McpProjectManager } from "../../mcp/McpProjectManager";
import { McpRestartPrompt } from "../../mcp/McpRestartPrompt";
import "../../mcp/Mcp.css";

type ViewMode = "matrix" | "apps";

interface EditorState {
  open: boolean;
  initial?: { entry: McpServerEntry; presentTargets: HostTarget[] } | null;
  preselect?: HostTarget | null;
}

interface PickerState {
  open: boolean;
  dest: HostTarget | null;
}

export function McpSection() {
  const mgr = useMcpManager();
  const [view, setView] = useState<ViewMode>("apps");
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [picker, setPicker] = useState<PickerState>({ open: false, dest: null });

  // ── Project ────────────────────────────────────────────────
  const handleAddProject = async (path: string) => {
    await mgr.registerProject(path);
    setView("apps");
  };

  // ── Global "Add server" button (no target pre-selected) ────
  const openAdd = () => setPicker({ open: true, dest: null });

  // ── Edit existing server (from All servers table) ──────────
  const openEdit = (name: string) => {
    const row = mgr.unified.find((u) => u.name === name);
    if (!row?.presence[0]) return;
    setEditor({
      open: true,
      initial: {
        entry: row.presence[0].entry,
        presentTargets: row.presence.map((p) => p.target),
      },
      preselect: null,
    });
  };

  // ── "Add to this host" from the matrix view ────────────────
  const openAddToTarget = (name: string, target: HostTarget) => {
    const row = mgr.unified.find((u) => u.name === name);
    if (row?.presence[0]) {
      mgr
        .copyServer(name, row.presence[0].target, [target], true)
        .catch((e) => console.error("[mcp] copy failed", e));
    } else {
      setPicker({ open: true, dest: target });
    }
  };

  // ── Called from Apps view "+" buttons ─────────────────────
  const openAddServer = (target: HostTarget) => {
    setPicker({ open: true, dest: target });
  };

  // ── Picker callbacks ───────────────────────────────────────
  const handlePickerCopy = async (
    server: string,
    from: HostTarget,
    to: HostTarget,
  ) => {
    await mgr.copyServer(server, from, [to], true);
    setPicker({ open: false, dest: null });
  };

  const handlePickerNew = () => {
    const dest = picker.dest;
    setPicker({ open: false, dest: null });
    setEditor({ open: true, initial: null, preselect: dest });
  };

  return (
    <div className="mcp-shell">
      <div className="mcp-toolbar">
        <div className="mcp-tabs" role="tablist">
          <button
            className={view === "apps" ? "active" : ""}
            onClick={() => setView("apps")}
          >
            Apps
          </button>
          <button
            className={view === "matrix" ? "active" : ""}
            onClick={() => setView("matrix")}
          >
            All servers
          </button>
        </div>
        <span className="spacer" />
        <button
          className="mcp-btn subtle"
          onClick={() => mgr.refresh()}
          disabled={mgr.loading}
        >
          {mgr.loading ? "…" : "Refresh"}
        </button>
        <button className="mcp-btn" onClick={openAdd}>
          + Add server
        </button>
      </div>

      {mgr.error && <div className="mcp-error">{mgr.error}</div>}

      {view === "apps" ? (
        <McpAppsView
          hosts={mgr.hosts}
          running={mgr.running}
          onToggle={(server, target, enabled) =>
            mgr.setEnabled(server, target, enabled).catch((e) => console.error(e))
          }
          onRemove={(server, target) =>
            mgr.removeServer(server, target).catch((e) => console.error(e))
          }
          onRestart={(host) =>
            mgr.restartHost(host).catch((e) => console.error(e))
          }
          onAddServer={openAddServer}
        />
      ) : (
        <McpMatrix
          hosts={mgr.hosts}
          unified={mgr.unified}
          onToggle={(server, target, enabled) =>
            mgr.setEnabled(server, target, enabled).catch((e) => console.error(e))
          }
          onAddToTarget={openAddToTarget}
          onEdit={openEdit}
          onRemove={(server, target) =>
            mgr.removeServer(server, target).catch((e) => console.error(e))
          }
        />
      )}

      <div style={{ marginTop: 8 }}>
        <McpProjectManager
          projects={mgr.projects}
          onAdd={handleAddProject}
          onRemove={mgr.unregisterProject}
        />
      </div>

      {/* Step 1: Pick source or choose "New" */}
      {picker.open && picker.dest && (
        <McpAddPicker
          dest={picker.dest}
          hosts={mgr.hosts}
          onCopy={handlePickerCopy}
          onNew={handlePickerNew}
          onClose={() => setPicker({ open: false, dest: null })}
        />
      )}

      {/* Global "+ Add server" (no dest) goes straight to editor */}
      {picker.open && !picker.dest && (
        <McpServerEditor
          hosts={mgr.hosts}
          initial={null}
          preselect={null}
          onCancel={() => setPicker({ open: false, dest: null })}
          onSave={(entry, targets, enabled) => mgr.addServer(entry, targets, enabled)}
        />
      )}

      {/* Step 2: Full editor (after choosing "New" from picker) */}
      {editor.open && (
        <McpServerEditor
          hosts={mgr.hosts}
          initial={editor.initial}
          preselect={editor.preselect}
          onCancel={() => setEditor({ open: false })}
          onSave={(entry, targets, enabled) =>
            mgr.addServer(entry, targets, enabled)
          }
        />
      )}

      {mgr.restartPrompt && (
        <McpRestartPrompt
          payload={mgr.restartPrompt}
          onRestart={mgr.restartHost}
          onDismiss={mgr.dismissRestartPrompt}
        />
      )}
    </div>
  );
}
