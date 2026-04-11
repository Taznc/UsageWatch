interface Props {
  label: string;
  amount: number; // in cents
  limitAmount?: number; // in cents, for extra_usage
  editMode?: boolean;
  onRemove?: () => void;
}

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MoneyTile({ label, amount, limitAmount, editMode, onRemove }: Props) {
  const fillPct = limitAmount && limitAmount > 0 ? Math.min((amount / limitAmount) * 100, 100) : 0;

  return (
    <div className="widget-tile money-tile">
      {editMode && onRemove && (
        <button className="tile-remove-btn" onClick={onRemove} title="Remove tile">×</button>
      )}
      <div className="money-amount">{centsToDisplay(amount)}</div>
      {limitAmount != null && (
        <div className="money-limit">of {centsToDisplay(limitAmount)}</div>
      )}
      <div className="tile-label">{label}</div>
      {limitAmount != null && (
        <div className="money-bar-track">
          <div
            className="money-bar-fill"
            style={{
              width: `${fillPct}%`,
              background: fillPct >= 90
                ? "var(--red)"
                : fillPct >= 75
                  ? "var(--orange)"
                  : "var(--green)",
            }}
          />
        </div>
      )}
    </div>
  );
}
