import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface StatusComponent {
  id: string;
  name: string;
  status: string;
}

interface IncidentUpdate {
  id: string;
  status: string;
  body: string;
  display_at: string;
  affected_components?: StatusComponent[];
}

interface Incident {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink?: string;
  incident_updates?: IncidentUpdate[];
}

interface StatusData {
  status: {
    indicator: string; // "none" | "minor" | "major" | "critical"
    description: string;
  };
  incidents?: Incident[];
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
  const activeIncident = status.incidents?.[0] ?? null;
  const latestUpdate = activeIncident?.incident_updates
    ?.slice()
    .sort((a, b) => new Date(b.display_at).getTime() - new Date(a.display_at).getTime())[0];
  const affectedComponents = latestUpdate?.affected_components?.map((component) => component.name) ?? [];
  const details = latestUpdate?.body?.trim() || activeIncident?.name?.trim() || "";
  const tooltip = [status.status.description, activeIncident?.name, details]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="status-indicator" title={tooltip}>
      <span className="status-dot" style={{ backgroundColor: color }} />
      <div className="status-copy">
        <span className="status-text">{status.status.description}</span>
        {activeIncident && (
          <>
            <span className="status-detail">{details}</span>
            {affectedComponents.length > 0 && (
              <span className="status-components">
                Affected: {affectedComponents.join(", ")}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
