import { useState, useEffect } from "react";
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

export function UsageBar({ label, percentage, resetAt, showRemaining = false, estimatedMinsToLimit }: UsageBarProps) {
  const [countdown, setCountdown] = useState(formatCountdown(resetAt));

  useEffect(() => {
    if (!resetAt) return;
    setCountdown(formatCountdown(resetAt));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(resetAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [resetAt]);

  const displayPct = showRemaining ? Math.max(0, 100 - percentage) : percentage;
  const color = getUsageColor(percentage);
  const resetDate = formatResetDate(resetAt);

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
      {resetAt && (
        <div className="usage-bar-footer">
          <span className="usage-bar-reset">
            Resets in {countdown}
            {resetDate && <span className="usage-bar-reset-date"> · {resetDate}</span>}
          </span>
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
