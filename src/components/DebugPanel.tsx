import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function DebugPanel() {
  const [raw, setRaw] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const fetchRaw = async () => {
    setLoading(true);
    try {
      const sessionKey = await invoke<string | null>("get_session_key");
      const orgId = await invoke<string | null>("get_org_id");
      if (!sessionKey || !orgId) {
        setRaw("No credentials configured");
        return;
      }
      const data = await invoke<string>("fetch_usage_raw", { sessionKey, orgId });
      setRaw(JSON.stringify(JSON.parse(data), null, 2));
    } catch (e: any) {
      setRaw(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="debug-panel">
      <button className="btn secondary" onClick={fetchRaw} disabled={loading}>
        {loading ? "Fetching..." : "Fetch Raw API Response"}
      </button>
      {raw && (
        <pre className="debug-output">{raw}</pre>
      )}
    </div>
  );
}
