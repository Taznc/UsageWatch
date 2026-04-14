import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function DebugPanel() {
  const [raw, setRaw] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string>("");

  const run = async (label: string, fn: () => Promise<string>) => {
    setLoading(true);
    setActiveAction(label);
    try {
      setRaw(await fn());
    } catch (e: any) {
      setRaw(String(e));
    } finally {
      setLoading(false);
      setActiveAction("");
    }
  };

  const fetchRaw = () => run("Fetching API...", async () => {
    const sessionKey = await invoke<string | null>("get_session_key");
    const orgId = await invoke<string | null>("get_org_id");
    if (!sessionKey || !orgId) return "No credentials configured";
    const data = await invoke<string>("fetch_usage_raw", { sessionKey, orgId });
    return JSON.stringify(JSON.parse(data), null, 2);
  });

  const debugClaudeDesktop = () => run("Diagnosing...", async () => {
    const lines = await invoke<string[]>("debug_claude_desktop_cookies");
    return lines.join("\n");
  });

  const debugCursorApi = () => run("Cursor API…", async () => {
    const text = await invoke<string>("debug_cursor_api");
    return text;
  });

  return (
    <div className="debug-panel">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn secondary" onClick={fetchRaw} disabled={loading}>
          {loading && activeAction === "Fetching API..." ? "Fetching..." : "Fetch Raw API Response"}
        </button>
        <button className="btn secondary" onClick={debugClaudeDesktop} disabled={loading}>
          {loading && activeAction === "Diagnosing..." ? "Diagnosing..." : "Diagnose Claude Desktop (Windows)"}
        </button>
        <button className="btn secondary" onClick={debugCursorApi} disabled={loading}>
          {loading && activeAction === "Cursor API…" ? "Running…" : "Cursor API diagnostics"}
        </button>
      </div>
      <p style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", maxWidth: 640, lineHeight: 1.45 }}>
        Cursor diagnostics mirror UsageWatch: Connect RPCs on <code>api2.cursor.sh</code>,{" "}
        <code>GET cursor.com/api/usage-summary</code> (desktop bearer or browser cookie), plus <code>GetHardLimit</code>{" "}
        and <code>GetUsageLimitPolicyStatus</code>. Compare field names with{" "}
        <a href="https://github.com/janekbaraniewski/openusage/tree/main/internal/providers/cursor" target="_blank" rel="noreferrer">
          openusage&apos;s Cursor provider
        </a>
        .
      </p>
      {raw && (
        <pre className="debug-output">{raw}</pre>
      )}
    </div>
  );
}
