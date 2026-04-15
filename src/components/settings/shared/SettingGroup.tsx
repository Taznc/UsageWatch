import type { ReactNode } from "react";

interface SettingGroupProps {
  label?: string;
  children: ReactNode;
}

export function SettingGroup({ label, children }: SettingGroupProps) {
  return (
    <div className="s-section-block">
      {label && <span className="s-label">{label}</span>}
      <div className="s-group">{children}</div>
    </div>
  );
}
