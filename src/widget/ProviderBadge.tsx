import type { CSSProperties } from "react";
import type { Provider } from "../types/usage";
import type { WidgetHeaderBadgeMode, WidgetHeaderBadgeStyle } from "../types/widget";
import claudeIcon from "../assets/providers/claude.png";
import codexIcon from "../assets/providers/codex.png";
import cursorIcon from "../assets/providers/cursor.png";

interface ProviderBadgeProps {
  provider: Provider;
  mode?: WidgetHeaderBadgeMode;
  badgeStyle?: WidgetHeaderBadgeStyle;
  size: number;
  className?: string;
}

const PROVIDER_ICONS: Record<Provider, string> = {
  Claude: claudeIcon,
  Codex: codexIcon,
  Cursor: cursorIcon,
};

const PROVIDER_ACCENTS: Record<Provider, { accent: string; tint: string; glow: string }> = {
  Claude: { accent: "#f59e0b", tint: "rgba(245, 158, 11, 0.2)", glow: "rgba(245, 158, 11, 0.42)" },
  Codex: { accent: "#34d399", tint: "rgba(52, 211, 153, 0.18)", glow: "rgba(52, 211, 153, 0.34)" },
  Cursor: { accent: "#60a5fa", tint: "rgba(96, 165, 250, 0.18)", glow: "rgba(96, 165, 250, 0.34)" },
};

export function ProviderBadge({
  provider,
  mode = "brand",
  badgeStyle = "glass",
  size,
  className,
}: ProviderBadgeProps) {
  const palette = PROVIDER_ACCENTS[provider];
  const style = {
    "--widget-provider-badge-size": `${size}px`,
    "--widget-provider-badge-accent": palette.accent,
    "--widget-provider-badge-tint": palette.tint,
    "--widget-provider-badge-glow": palette.glow,
  } as CSSProperties;

  return (
    <span
      className={[
        "widget-provider-badge",
        `widget-provider-badge--${provider.toLowerCase()}`,
        `widget-provider-badge--${badgeStyle}`,
        `widget-provider-badge--${mode}`,
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    >
      <span className="widget-provider-badge__surface">
        <img
          src={PROVIDER_ICONS[provider]}
          alt=""
          className="widget-provider-badge__image"
          draggable={false}
        />
      </span>
    </span>
  );
}
