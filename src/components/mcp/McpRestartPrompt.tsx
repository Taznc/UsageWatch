import { useState } from "react";
import type { McpHost, RestartPromptPayload } from "../../types/mcp";
import { HOST_LABELS } from "../../types/mcp";

interface Props {
  payload: RestartPromptPayload;
  onRestart: (host: McpHost) => Promise<void>;
  onDismiss: () => void;
}

export function McpRestartPrompt({ payload, onRestart, onDismiss }: Props) {
  const [busy, setBusy] = useState<McpHost | null>(null);
  const [done, setDone] = useState<Set<McpHost>>(new Set());

  const handle = async (h: McpHost) => {
    setBusy(h);
    try {
      await onRestart(h);
      setDone((s) => new Set(s).add(h));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mcp-modal-backdrop" onClick={onDismiss}>
      <div className="mcp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Restart to apply change</h3>
        <p style={{ fontSize: 12, opacity: 0.8, marginTop: 0 }}>
          <strong>{payload.server}</strong> changed. Restart the running app(s)
          to apply:
        </p>
        {payload.hosts.map((h) => (
          <div className="mcp-target-row" key={h}>
            <span style={{ flex: 1 }}>{HOST_LABELS[h]}</span>
            {done.has(h) ? (
              <span style={{ color: "#5ec88a", fontSize: 11 }}>restarted</span>
            ) : (
              <button
                className="mcp-btn"
                disabled={busy !== null}
                onClick={() => handle(h)}
              >
                {busy === h ? "Restarting…" : "Restart"}
              </button>
            )}
          </div>
        ))}
        <div className="mcp-actions">
          <button className="mcp-btn subtle" onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
