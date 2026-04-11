interface Props {
  indicator: string;
  description: string;
  editMode?: boolean;
  onRemove?: () => void;
}

function indicatorColor(indicator: string): string {
  switch (indicator) {
    case "minor": return "var(--orange)";
    case "major":
    case "critical": return "var(--red)";
    default: return "var(--green)";
  }
}

function indicatorBg(indicator: string): string {
  switch (indicator) {
    case "minor": return "rgba(245,158,11,0.08)";
    case "major":
    case "critical": return "rgba(239,68,68,0.08)";
    default: return "rgba(34,197,94,0.08)";
  }
}

export function StatusTile({ indicator, description, editMode, onRemove }: Props) {
  const color = indicatorColor(indicator);

  return (
    <div
      className="widget-tile status-tile"
      style={{ background: indicatorBg(indicator) }}
    >
      {editMode && onRemove && (
        <button className="tile-remove-btn" onClick={onRemove} title="Remove tile">×</button>
      )}
      <div className="status-row">
        <span className="status-dot" style={{ background: color }} />
        <span className="status-desc">{description || "All systems operational"}</span>
      </div>
      <div className="tile-label">API Status</div>
    </div>
  );
}
