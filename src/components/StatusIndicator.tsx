import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface StatusData {
  status: {
    indicator: string; // "none" | "minor" | "major" | "critical"
    description: string;
  };
}

const STATUS_COLORS: Record<string, string> = {
  none: "#22c55e",
  minor: "#f59e0b",
  major: "#f97316",
  critical: "#ef4444",
};

export function StatusIndicator() {
  const [status, setStatus] = useState<StatusData | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const data = await invoke<StatusData>("fetch_status");
        setStatus(data);
      } catch {
        // Silently fail — status indicator is non-critical
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const color = STATUS_COLORS[status.status.indicator] || "#8892a4";

  return (
    <div className="status-indicator" title={status.status.description}>
      <span className="status-dot" style={{ backgroundColor: color }} />
      <span className="status-text">{status.status.description}</span>
    </div>
  );
}
