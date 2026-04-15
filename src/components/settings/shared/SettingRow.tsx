import type { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
  /** When true, stacks label above children instead of side-by-side */
  column?: boolean;
}

export function SettingRow({ label, hint, children, column }: SettingRowProps) {
  return (
    <div className={`s-row${column ? " s-row--col" : ""}`}>
      <div className="s-row-left">
        <div className="s-row-label">{label}</div>
        {hint && <div className="s-row-hint">{hint}</div>}
      </div>
      <div className="s-row-control">{children}</div>
    </div>
  );
}
