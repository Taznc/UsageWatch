import type { CSSProperties, ReactNode } from "react";

const blockTitle: CSSProperties = {
  marginTop: 12,
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  opacity: 0.92,
};

const rpcTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 4,
  opacity: 0.88,
};

const rawPre: CSSProperties = {
  marginTop: 6,
  fontSize: 10,
  maxHeight: 160,
  overflow: "auto",
  padding: 8,
  borderRadius: 6,
  background: "var(--surface-elevated, rgba(255,255,255,0.04))",
  border: "1px solid var(--border)",
};

function labelFromKey(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatExtraValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString()
      : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
    }
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "None";
    return `${v.length} entries`;
  }
  return "…";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function friendlyRpcTitle(method: string): string {
  const body = method.replace(/^Get/, "");
  const spaced = body.replace(/([A-Z])/g, " $1").trim();
  return spaced || method;
}

/** Recursively render plain objects as extra-usage-details rows (bounded depth). */
function renderObjectDepth(
  obj: Record<string, unknown>,
  depth: number,
  maxDepth: number,
): ReactNode {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return (
      <div className="extra-usage-details" style={{ opacity: 0.75 }}>
        <span>Details</span>
        <span>None</span>
      </div>
    );
  }

  return keys.map((key) => {
    const val = obj[key];
    if (isPlainObject(val) && depth < maxDepth && Object.keys(val).length > 0) {
      return (
        <div key={key} style={{ marginTop: depth === 0 ? 6 : 4 }}>
          <div style={{ fontSize: 11, opacity: 0.82, fontWeight: 600 }}>{labelFromKey(key)}</div>
          <div style={{ paddingLeft: 10, marginTop: 4 }}>
            {renderObjectDepth(val, depth + 1, maxDepth)}
          </div>
        </div>
      );
    }
    return (
      <div key={key} className="extra-usage-details">
        <span title={key}>{labelFromKey(key)}</span>
        <span>{formatExtraValue(val)}</span>
      </div>
    );
  });
}

export function CursorConnectExtrasFriendly({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <>
      <h3 style={blockTitle}>Connect RPC details</h3>
      {entries.map(([rpc, payload]) => (
        <div key={rpc} style={{ marginBottom: 14 }}>
          <div style={rpcTitle}>{friendlyRpcTitle(rpc)}</div>
          <div style={{ paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
            {isPlainObject(payload) ? (
              renderObjectDepth(payload, 0, 6)
            ) : (
              <div className="extra-usage-details">
                <span>Response</span>
                <span>{formatExtraValue(payload)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.65 }}>Raw JSON</summary>
        <pre style={rawPre}>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </>
  );
}

export function CursorEnterpriseUsageFriendly({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <>
      <h3 style={blockTitle}>Enterprise usage (by model)</h3>
      {entries.map(([modelId, payload]) => (
        <div key={modelId} style={{ marginBottom: 14 }}>
          <div style={rpcTitle}>Model: {modelId}</div>
          <div style={{ paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
            {isPlainObject(payload) ? (
              renderObjectDepth(payload, 0, 6)
            ) : (
              <div className="extra-usage-details">
                <span>Value</span>
                <span>{formatExtraValue(payload)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.65 }}>Raw JSON</summary>
        <pre style={rawPre}>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </>
  );
}
