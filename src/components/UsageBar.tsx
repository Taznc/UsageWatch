import { useState, useEffect } from "react";
import { getUsageColor, formatCountdown } from "../utils/format";

interface UsageBarProps {
  label: string;
  percentage: number;
  resetAt: string | null;
  showRemaining?: boolean;
}

export function UsageBar({ label, percentage, resetAt, showRemaining = false }: UsageBarProps) {
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
          <span className="usage-bar-reset">Resets in {countdown}</span>
        </div>
      )}
    </div>
  );
}
