import { useState, useEffect, useMemo } from "react";
import { getUsageColor, formatCountdown, formatResetDate } from "../utils/format";

function formatBurnRate(mins: number): string {
  if (mins === 0) return "At limit";
  if (mins < 60) return `~${mins}m until limit at current pace`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0
      ? `~${h}h ${m}m until limit at current pace`
      : `~${h}h until limit at current pace`;
  }
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return h > 0
    ? `~${d}d ${h}h until limit at current pace`
    : `~${d}d until limit at current pace`;
}

interface UsageBarProps {
  label: string;
  percentage: number;
  resetAt: string | null;
  showRemaining?: boolean;
  estimatedMinsToLimit?: number | null;
}

function formatResetAnchor(resetAt: string): string {
  return new Date(resetAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UsageBar({ label, percentage, resetAt, showRemaining = false, estimatedMinsToLimit }: UsageBarProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!resetAt) return;
    const resetMs = new Date(resetAt).getTime();
    if (!Number.isFinite(resetMs) || resetMs <= Date.now()) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [resetAt]);

  const displayPct = showRemaining ? Math.max(0, 100 - percentage) : percentage;
  const color = getUsageColor(percentage);

  const resetFooter = useMemo(() => {
    if (!resetAt) return null;
    const resetMs = new Date(resetAt).getTime();
    if (!Number.isFinite(resetMs)) return null;
    const diff = resetMs - Date.now();
    if (diff <= 0) {
      return `Cycle date · ${formatResetAnchor(resetAt)}`;
    }
    const countdown = formatCountdown(resetAt);
    const resetDate = formatResetDate(resetAt);
    return `Resets in ${countdown}${resetDate ? ` · ${resetDate}` : ""}`;
  }, [resetAt, tick]);

  return (
    <div className="usage-bar-container">
      <div className="usage-bar-header">
        <span className="usage-bar-label">{label}</span>
        <span className="usage-bar-pct" style={{ color }}>
          {displayPct.toFixed(1)}%{showRemaining ? " left" : " used"}
        </span>
      </div>
      <div className="usage-bar-track">
        <div
          className="usage-bar-fill"
          style={{
            width: `${Math.min(percentage, 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>
      {resetFooter && (
        <div className="usage-bar-footer">
          <span className="usage-bar-reset">{resetFooter}</span>
          {estimatedMinsToLimit != null && (
            <div className="usage-bar-burn-rate">
              {formatBurnRate(estimatedMinsToLimit)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
