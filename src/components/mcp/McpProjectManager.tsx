import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  projects: string[];
  onAdd: (path: string) => Promise<void>;
  onRemove: (path: string) => Promise<void>;
}

export function McpProjectManager({ projects, onAdd, onRemove }: Props) {
  const pick = async () => {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string" && result) {
      await onAdd(result);
    }
  };

  return (
    <div>
      <div className="mcp-toolbar">
        <strong style={{ fontSize: 12 }}>Project configs</strong>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Add a project root to scan its <code>.mcp.json</code> /{" "}
          <code>.cursor/mcp.json</code>
        </span>
        <span className="spacer" />
        <button className="mcp-btn subtle" onClick={pick}>
          + Project
        </button>
      </div>
      {projects.length === 0 ? (
        <div className="mcp-empty">No project roots registered.</div>
      ) : (
        <>
          <p className="mcp-hint">
            Each registered project appears as a host card above (By Host view), showing its{" "}
            <code>.mcp.json</code> / <code>.cursor/mcp.json</code> servers.
          </p>
          <ul className="mcp-project-list">
            {projects.map((p) => (
              <li key={p}>
                <span className="path">{p}</span>
                <button
                  className="mcp-btn subtle"
                  onClick={() => onRemove(p)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
