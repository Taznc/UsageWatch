import type { CSSProperties } from "react";
import { UsageBar } from "./UsageBar";
import { formatCurrencyFromCents } from "../utils/format";

const rawPre: CSSProperties = {
  marginTop: 8,
  fontSize: 10,
  maxHeight: 140,
  overflow: "auto",
  padding: 8,
  borderRadius: 6,
  background: "var(--surface-elevated, rgba(255,255,255,0.04))",
  border: "1px solid var(--border)",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Pull limitType from Connect extras payloads (any nesting). */
export function extractCursorLimitType(extras: Record<string, unknown>): string | null {
  for (const val of Object.values(extras)) {
    if (!isPlainObject(val)) continue;
    if (typeof val.limitType === "string" && val.limitType) return val.limitType;
    const inner = val.usageLimitPolicyStatus;
    if (isPlainObject(inner) && typeof inner.limitType === "string" && inner.limitType) {
      return inner.limitType;
    }
  }
  return null;
}

function friendlyLimitType(raw: string): string {
  const m: Record<string, string> = {
    "user-team": "Personal & team",
    user: "Personal",
    team: "Team",
    "user_team": "Personal & team",
  };
  return m[raw] ?? raw.replace(/-/g, " ");
}

/** Subtle row matching peak-hours / status strip — not an RPC dump. */
export function CursorAccountLimitBadge({ connectExtras }: { connectExtras: Record<string, unknown> }) {
  const lt = extractCursorLimitType(connectExtras);
  if (!lt) return null;
  return (
    <div
      className="peak-hours-badge"
      style={{ cursor: "default", marginTop: 8 }}
      title="How Cursor applies usage limits to your account"
    >
      <span style={{ opacity: 0.9 }}>Limit policy · {friendlyLimitType(lt)}</span>
    </div>
  );
}

type EnterpriseRow = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Enterprise /api/usage model entries as UsageBar + stats (Claude-style). */
export function CursorEnterpriseVisualSection({
  data,
  cycleResetsAt,
}: {
  data: Record<string, unknown>;
  cycleResetsAt: string | null;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div className="usage-section">
      <h2 className="section-heading">API usage by model</h2>
      {entries.map(([modelId, raw]) => {
        if (!isPlainObject(raw)) return null;
        const row = raw as EnterpriseRow;
        const numRequestsTotal = num(row.numRequestsTotal) || num(row.numRequests);
        const numTokens = num(row.numTokens);
        const maxReq = num(row.maxRequestUsage);
        const maxTok = num(row.maxTokenUsage);
        const startOfMonth = typeof row.startOfMonth === "string" ? row.startOfMonth : null;

        const reqPct = maxReq > 0 ? Math.min(100, (numRequestsTotal / maxReq) * 100) : null;
        const tokPct = maxTok > 0 ? Math.min(100, (numTokens / maxTok) * 100) : null;

        return (
          <div key={modelId} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.85,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {modelId.replace(/-/g, " ")}
            </div>
            {reqPct != null && (
              <UsageBar
                label="Requests"
                percentage={reqPct}
                resetAt={cycleResetsAt}
                showRemaining={false}
              />
            )}
            {tokPct != null && (
              <div style={{ marginTop: 8 }}>
                <UsageBar label="Tokens" percentage={tokPct} resetAt={cycleResetsAt} showRemaining={false} />
              </div>
            )}
            {reqPct == null && tokPct == null && (
              <div className="usage-bar-container">
                <div className="usage-bar-header">
                  <span className="usage-bar-label">Activity</span>
                </div>
                <div className="extra-usage-details" style={{ marginTop: 4 }}>
                  <span>{numRequestsTotal.toLocaleString()} requests</span>
                  <span>{numTokens.toLocaleString()} tokens</span>
                </div>
                {startOfMonth && (
                  <div className="usage-bar-footer">
                    <span className="usage-bar-reset">
                      Period from{" "}
                      {new Date(startOfMonth).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}
            {(reqPct != null || tokPct != null) && (
              <div className="extra-usage-details" style={{ marginTop: 4 }}>
                {maxReq > 0 && (
                  <span>
                    {numRequestsTotal.toLocaleString()} / {maxReq.toLocaleString()} requests
                  </span>
                )}
                {maxTok > 0 && (
                  <span>
                    {numTokens.toLocaleString()} / {maxTok.toLocaleString()} tokens
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CursorTechnicalDetailsCollapsible({
  connectExtras,
  enterpriseUsage,
}: {
  connectExtras: Record<string, unknown> | null;
  enterpriseUsage: Record<string, unknown> | null;
}) {
  const hasConnect = connectExtras != null && Object.keys(connectExtras).length > 0;
  const hasEnt = enterpriseUsage != null && Object.keys(enterpriseUsage).length > 0;
  if (!hasConnect && !hasEnt) return null;

  const payload: Record<string, unknown> = {};
  if (hasConnect) payload.connect_extras = connectExtras!;
  if (hasEnt) payload.enterprise_usage = enterpriseUsage!;

  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.55 }}>
        Technical details (raw API)
      </summary>
      <pre style={rawPre}>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

/** When Connect reports remaining included cents vs a limit, show a Claude-style bar. */
export function CursorIncludedRemainingBar({
  planRemainingCents,
  limitCents,
  cycleResetsAt,
  showRemaining,
}: {
  planRemainingCents: number;
  limitCents: number;
  cycleResetsAt: string | null;
  showRemaining: boolean;
}) {
  if (limitCents <= 0 || planRemainingCents < 0) return null;
  const usedFromIncluded = Math.max(0, limitCents - planRemainingCents);
  const pct = Math.min(100, (usedFromIncluded / limitCents) * 100);
  return (
    <div style={{ marginTop: 10 }}>
      <UsageBar
        label="Included allowance used"
        percentage={pct}
        resetAt={cycleResetsAt}
        showRemaining={showRemaining}
      />
      <div className="extra-usage-details" style={{ marginTop: 4 }}>
        <span>{formatCurrencyFromCents(usedFromIncluded)} used</span>
        <span>{formatCurrencyFromCents(planRemainingCents)} left</span>
      </div>
    </div>
  );
}
