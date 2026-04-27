import { useState } from "react";
import type { McpHost, RestartPromptPayload } from "../../types/mcp";
import { HOST_LABELS } from "../../types/mcp";

interface Props {
  payload: RestartPromptPayload;
  onRestart: (host: McpHost, server: string) => Promise<void>;
  onDismiss: () => void;
}

export function McpRestartPrompt({ payload, onRestart, onDismiss }: Props) {
  const [busy, setBusy] = useState<McpHost | null>(null);
  const [done, setDone] = useState<Set<McpHost>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handle = async (h: McpHost) => {
    setBusy(h);
    setError(null);
    try {
      await onRestart(h, payload.server);
      setDone((s) => new Set(s).add(h));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mcp-modal-backdrop" onClick={onDismiss}>
      <div className="mcp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Restart to apply change</h3>
        <p style={{ fontSize: 12, opacity: 0.8, marginTop: 0 }}>
          <strong>{payload.server}</strong> changed. Restart its MCP process
          without closing the app:
        </p>
        {payload.hosts.map((h) => (
          <div className="mcp-target-row" key={h}>
            <span style={{ flex: 1 }}>{HOST_LABELS[h]}</span>
            {done.has(h) ? (
              <span style={{ color: "#5ec88a", fontSize: 11 }}>restarted</span>
            ) : (
              <button
                type="button"
                className="mcp-btn"
                disabled={busy !== null}
                onClick={() => handle(h)}
              >
                {busy === h ? "Restarting…" : "Restart MCP"}
              </button>
            )}
          </div>
        ))}
        {error && <div className="mcp-error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="mcp-actions">
          <button
            type="button"
            className="mcp-btn subtle"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
