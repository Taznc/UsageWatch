import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  WidgetCardViewModel,
  WidgetDensity,
  WidgetResetDisplayMode,
} from "../types/widget";
import type { WidgetThemeDefinition } from "./themes";

interface WidgetCardProps {
  card: WidgetCardViewModel;
  density: WidgetDensity;
  theme: WidgetThemeDefinition;
  resetDisplayMode?: WidgetResetDisplayMode;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

function compactLabel(card: WidgetCardViewModel, theme: WidgetThemeDefinition) {
  if (theme.useAbbreviatedLabels) {
    return card.shortTitle ?? card.title.slice(0, 3).toUpperCase();
  }
  return card.title;
}

function clampProgress(progress?: number | null) {
  if (progress == null || Number.isNaN(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(100, progress));
}

function terminalLabel(card: WidgetCardViewModel) {
  return `// ${card.title.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")}.stat`;
}

export function resolveWidgetCardSecondary(
  card: WidgetCardViewModel,
  resetDisplayMode: WidgetResetDisplayMode = "time",
) {
  if (resetDisplayMode === "both" && card.secondaryBoth) {
    return card.secondaryBoth;
  }
  if (resetDisplayMode === "countdown" && card.secondaryCountdown) {
    return card.secondaryCountdown;
  }
  return card.secondary;
}

function showSecondary(
  card: WidgetCardViewModel,
  theme: WidgetThemeDefinition,
  resetDisplayMode: WidgetResetDisplayMode,
) {
  return Boolean(resolveWidgetCardSecondary(card, resetDisplayMode) && theme.showSecondaryByDefault);
}

function SlabStackCard({
  card,
  theme,
  resetDisplayMode = "time",
  onPointerDown,
}: Pick<WidgetCardProps, "card" | "theme" | "resetDisplayMode" | "onPointerDown">) {
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);

  return (
    <section
      className={`widget-card widget-card--slab${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__orb" />
      <div className="widget-card__slab-badge">
        <div className="widget-card__icon widget-card__icon--slab">{card.icon}</div>
      </div>
      <div className="widget-card__slab-body">
        <div className="widget-card__eyebrow-row">
          <div className="widget-card__title widget-card__title--slab">{card.title}</div>
          {card.progress != null && <div className="widget-card__eyebrow-value">{Math.round(clampProgress(card.progress))}%</div>}
        </div>
        <div className="widget-card__primary widget-card__primary--slab">{card.primary}</div>
        {showSecondary(card, theme, resetDisplayMode) && detailText && (
          <div className="widget-card__secondary widget-card__secondary--slab">{detailText}</div>
        )}
        {card.progress != null && (
          <div className="widget-card__progress widget-card__progress--slab">
            <div className="widget-card__progress-fill" style={{ width: `${clampProgress(card.progress)}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

function MicroRailCard({
  card,
  theme,
  resetDisplayMode = "time",
  onPointerDown,
}: Pick<WidgetCardProps, "card" | "theme" | "resetDisplayMode" | "onPointerDown">) {
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);

  return (
    <section
      className={`widget-card widget-card--rail${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__rail-topline">
        <div className="widget-card__rail-leading">
          <span className="widget-card__icon widget-card__icon--rail">{card.icon}</span>
          <span className="widget-card__title widget-card__title--rail">{compactLabel(card, theme)}</span>
        </div>
        <div className="widget-card__primary widget-card__primary--rail">{card.primary}</div>
      </div>
      <div className="widget-card__rail-meter-row">
        <div className="widget-card__rail-meter">
          <div className="widget-card__rail-fill" style={{ width: `${clampProgress(card.progress)}%` }} />
        </div>
        <div className="widget-card__rail-percent">{card.progress != null ? `${Math.round(clampProgress(card.progress))}%` : "--"}</div>
      </div>
      {showSecondary(card, theme, resetDisplayMode) && detailText && (
        <div className="widget-card__secondary widget-card__secondary--rail">{detailText}</div>
      )}
    </section>
  );
}

function OrbitGaugeCard({ card, density, theme, resetDisplayMode = "time", onPointerDown }: WidgetCardProps) {
  const pct = clampProgress(card.progress);
  const sizeMap: Record<WidgetDensity, number> = {
    "ultra-compact": 58,
    compact: 78,
    comfortable: 100,
  };
  const size = sizeMap[density];
  const strokeWidth = theme.gaugeThickness?.[density] ?? 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const center = size / 2;
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);
  const centerValue = card.progress != null ? `${Math.round(pct)}%` : card.primary;

  return (
    <section
      className={`widget-card widget-card--orbit${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__orbit-gauge">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="widget-card__orbit-svg">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--widget-card-progress-track)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--widget-card-accent)"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={card.progress != null ? offset : circumference * 0.24}
            strokeLinecap="round"
            className="widget-card__orbit-arc"
          />
        </svg>
        <div className="widget-card__orbit-center">
          <span className="widget-card__primary widget-card__primary--orbit">{centerValue}</span>
        </div>
      </div>
      <div className="widget-card__orbit-label-row">
        <span className="widget-card__icon widget-card__icon--orbit">{card.icon}</span>
        <span className="widget-card__title widget-card__title--orbit">{compactLabel(card, theme)}</span>
      </div>
      {showSecondary(card, theme, resetDisplayMode) && detailText && (
        <div className="widget-card__secondary widget-card__secondary--orbit">{detailText}</div>
      )}
    </section>
  );
}

function TerminalDeckCard({
  card,
  theme,
  resetDisplayMode = "time",
  onPointerDown,
}: Pick<WidgetCardProps, "card" | "theme" | "resetDisplayMode" | "onPointerDown">) {
  const pct = clampProgress(card.progress);
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);

  return (
    <section
      className={`widget-card widget-card--terminal${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__terminal-topline">
        <span className="widget-card__terminal-label">{terminalLabel(card)}</span>
        <span className="widget-card__terminal-kicker">
          {card.progress != null ? `${Math.round(pct)}%` : card.icon}
        </span>
      </div>
      <div className="widget-card__terminal-body">
        <div className="widget-card__primary widget-card__primary--terminal">{card.primary}</div>
        {showSecondary(card, theme, resetDisplayMode) && detailText && (
          <div className="widget-card__secondary widget-card__secondary--terminal">{detailText}</div>
        )}
      </div>
      {card.progress != null && (
        <div className="widget-card__terminal-meter">
          <div className="widget-card__terminal-meter-fill" style={{ width: `${pct}%` }} />
          <div className="widget-card__terminal-meter-glow" style={{ width: `${pct}%` }} />
        </div>
      )}
    </section>
  );
}

export function WidgetCard({ card, density, theme, resetDisplayMode = "time", onPointerDown }: WidgetCardProps) {
  const style = {
    "--widget-card-padding": theme.cardPadding[density],
    "--widget-card-radius": theme.cardRadius,
    "--widget-card-surface": theme.cardSurface,
    "--widget-card-border": theme.cardBorder,
    "--widget-card-shadow": theme.cardShadow,
    "--widget-card-blur": theme.cardBlur,
    "--widget-card-icon-size": `${theme.iconSize[density]}px`,
    "--widget-card-icon-bg": theme.iconBackground,
    "--widget-card-title-font": theme.titleStyle,
    "--widget-card-primary-font": theme.primarySize[density],
    "--widget-card-secondary-font": theme.secondaryStyle[density],
    "--widget-card-progress-track": theme.progressTrack,
    "--widget-card-accent": theme.id === "mono-ticker" ? "rgba(236, 240, 243, 0.88)" : card.accent,
    "--widget-card-min-width": `${theme.cardMinWidth[density]}px`,
    "--widget-card-min-height": `${theme.cardMinHeight[density]}px`,
    "--widget-gauge-thickness": `${theme.gaugeThickness?.[density] ?? 10}px`,
    "--widget-rail-thickness": `${theme.railThickness?.[density] ?? 6}px`,
  } as CSSProperties;

  return (
    <div
      className={[
        "widget-card-frame",
        `widget-card-frame--${theme.id}`,
        `widget-card-frame--${theme.layoutFamily}`,
        `widget-card-frame--${density}`,
      ].join(" ")}
      style={style}
      data-layout-family={theme.layoutFamily}
      data-theme-id={theme.id}
      data-density={density}
    >
      {theme.layoutFamily === "micro-rail" ? (
        <MicroRailCard
          card={card}
          theme={theme}
          resetDisplayMode={resetDisplayMode}
          onPointerDown={onPointerDown}
        />
      ) : theme.layoutFamily === "orbit-gauges" ? (
        <OrbitGaugeCard
          card={card}
          density={density}
          theme={theme}
          resetDisplayMode={resetDisplayMode}
          onPointerDown={onPointerDown}
        />
      ) : theme.layoutFamily === "terminal-deck" ? (
        <TerminalDeckCard
          card={card}
          theme={theme}
          resetDisplayMode={resetDisplayMode}
          onPointerDown={onPointerDown}
        />
      ) : (
        <SlabStackCard
          card={card}
          theme={theme}
          resetDisplayMode={resetDisplayMode}
          onPointerDown={onPointerDown}
        />
      )}
    </div>
  );
}
