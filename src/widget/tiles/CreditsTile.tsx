interface Props {
  label: string;
  unlimited?: boolean;
  balance?: string | null; // string like "8.50"
  hasCredits?: boolean;
  editMode?: boolean;
  onRemove?: () => void;
}

export function CreditsTile({ label, unlimited, balance, hasCredits, editMode, onRemove }: Props) {
  let display: string;
  if (unlimited) {
    display = "Unlimited";
  } else if (hasCredits && balance) {
    const num = parseFloat(balance);
    display = isNaN(num) ? balance : `$${num.toFixed(2)}`;
  } else {
    display = "$0.00";
  }

  return (
    <div className="widget-tile credits-tile">
      {editMode && onRemove && (
        <button className="tile-remove-btn" onClick={onRemove} title="Remove tile">×</button>
      )}
      <div className={`credits-display ${unlimited ? "credits-unlimited" : ""}`}>
        {display}
      </div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
