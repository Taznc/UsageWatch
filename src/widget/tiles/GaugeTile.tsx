import { useState, useEffect } from "react";
import { getUsageColor } from "../../utils/format";
import { formatCountdown } from "../../utils/format";

interface Props {
  label: string;
  pct: number;
  resetsAt: string | null;
  /** If true, tile is in edit mode (shows drag handle hint) */
  editMode?: boolean;
  onRemove?: () => void;
}

// SVG arc math: 240° sweep gauge, starts at bottom-left, ends at bottom-right
const CX = 30;
const CY = 32;
const R = 24;
const START_DEG = 150;
const SWEEP_DEG = 240;

function polarToXY(deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}

function buildArcPath(fromDeg: number, toDeg: number) {
  const start = polarToXY(fromDeg);
  const end = polarToXY(toDeg);
  const sweep = toDeg - fromDeg;
  const large = sweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function GaugeTile({ label, pct, resetsAt, editMode, onRemove }: Props) {
  const [countdown, setCountdown] = useState(() => formatCountdown(resetsAt));

  useEffect(() => {
    setCountdown(formatCountdown(resetsAt));
    const id = setInterval(() => setCountdown(formatCountdown(resetsAt)), 1000);
    return () => clearInterval(id);
  }, [resetsAt]);

  const clamped = Math.min(Math.max(pct, 0), 100);
  const color = getUsageColor(clamped);
  const endDeg = START_DEG + SWEEP_DEG * (clamped / 100);

  const trackPath = buildArcPath(START_DEG, START_DEG + SWEEP_DEG);
  const progressPath = clamped > 0 ? buildArcPath(START_DEG, endDeg) : null;

  return (
    <div className="widget-tile gauge-tile">
      {editMode && onRemove && (
        <button className="tile-remove-btn" onClick={onRemove} title="Remove tile">×</button>
      )}
      <svg width="60" height="64" viewBox="0 0 60 64" className="gauge-svg">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--border)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Progress */}
        {progressPath && (
          <path
            d={progressPath}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {/* Percentage label */}
        <text
          x={CX}
          y={CY + 5}
          textAnchor="middle"
          fill="var(--text)"
          fontSize="11"
          fontWeight="600"
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        >
          {Math.round(clamped)}%
        </text>
      </svg>
      <div className="tile-label">{label}</div>
      <div className="tile-sub">{countdown}</div>
    </div>
  );
}
