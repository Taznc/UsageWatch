import { UsageBar } from "./UsageBar";
import { formatCurrencyFromCents } from "../utils/format";

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
