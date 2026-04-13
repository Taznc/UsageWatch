import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { WidgetCardViewModel, WidgetDensity } from "../types/widget";
import type { WidgetThemeDefinition } from "./themes";

interface WidgetCardProps {
  card: WidgetCardViewModel;
  density: WidgetDensity;
  theme: WidgetThemeDefinition;
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

function showSecondary(card: WidgetCardViewModel, theme: WidgetThemeDefinition) {
  return Boolean(card.secondary && theme.showSecondaryByDefault);
}

function SlabStackCard({ card, theme, onPointerDown }: Pick<WidgetCardProps, "card" | "theme" | "onPointerDown">) {
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
        {showSecondary(card, theme) && <div className="widget-card__secondary widget-card__secondary--slab">{card.secondary}</div>}
        {card.progress != null && (
          <div className="widget-card__progress widget-card__progress--slab">
            <div className="widget-card__progress-fill" style={{ width: `${clampProgress(card.progress)}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

function MeterColumnCard({ card, theme, onPointerDown }: Pick<WidgetCardProps, "card" | "theme" | "onPointerDown">) {
  return (
    <section
      className={`widget-card widget-card--meter${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__meter-topline">
        <div className="widget-card__title widget-card__title--meter">{compactLabel(card, theme)}</div>
        <div className="widget-card__icon widget-card__icon--meter">{card.icon}</div>
      </div>
      <div className="widget-card__meter-stage">
        <div className="widget-card__meter-column">
          <div className="widget-card__meter-track">
            <div className="widget-card__meter-fill" style={{ height: `${clampProgress(card.progress)}%` }} />
          </div>
        </div>
        <div className="widget-card__meter-copy">
          <div className="widget-card__primary widget-card__primary--meter">{card.primary}</div>
          {showSecondary(card, theme) ? (
            <div className="widget-card__secondary widget-card__secondary--meter">{card.secondary}</div>
          ) : (
            card.progress != null && <div className="widget-card__meter-percent">{Math.round(clampProgress(card.progress))}%</div>
          )}
        </div>
      </div>
    </section>
  );
}

function MicroRailCard({ card, theme, onPointerDown }: Pick<WidgetCardProps, "card" | "theme" | "onPointerDown">) {
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
      {showSecondary(card, theme) && <div className="widget-card__secondary widget-card__secondary--rail">{card.secondary}</div>}
    </section>
  );
}

function TelemetryPanelCard({ card, theme, onPointerDown }: Pick<WidgetCardProps, "card" | "theme" | "onPointerDown">) {
  return (
    <section
      className={`widget-card widget-card--panel${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__panel-topline">
        <div className="widget-card__panel-label">
          <span className="widget-card__icon widget-card__icon--panel">{card.icon}</span>
          <span className="widget-card__title widget-card__title--panel">{compactLabel(card, theme)}</span>
        </div>
        <span className="widget-card__panel-kicker">{card.provider}</span>
      </div>
      <div className="widget-card__panel-body">
        <div className="widget-card__primary widget-card__primary--panel">{card.primary}</div>
        <div className="widget-card__panel-meter">
          <div className="widget-card__panel-meter-fill" style={{ width: `${clampProgress(card.progress)}%` }} />
        </div>
      </div>
      {showSecondary(card, theme) && <div className="widget-card__secondary widget-card__secondary--panel">{card.secondary}</div>}
    </section>
  );
}


function MatrixRainCard({ card, theme, onPointerDown }: Pick<WidgetCardProps, "card" | "theme" | "onPointerDown">) {
  const pct = clampProgress(card.progress);
  return (
    <section
      className={`widget-card widget-card--matrix${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__matrix-scanline" />
      <div className="widget-card__matrix-row">
        <div className="widget-card__matrix-glyph">{card.icon}</div>
        <div className="widget-card__matrix-data">
          <span className="widget-card__title widget-card__title--matrix">{compactLabel(card, theme)}</span>
          <span className="widget-card__primary widget-card__primary--matrix">{card.primary}</span>
        </div>
        {card.progress != null && (
          <span className="widget-card__matrix-pct">{Math.round(pct)}%</span>
        )}
      </div>
      {card.progress != null && (
        <div className="widget-card__matrix-bar">
          <div className="widget-card__matrix-bar-fill" style={{ width: `${pct}%` }} />
          <div className="widget-card__matrix-bar-glow" style={{ width: `${pct}%` }} />
        </div>
      )}
      {showSecondary(card, theme) && <div className="widget-card__secondary widget-card__secondary--matrix">{card.secondary}</div>}
    </section>
  );
}

function DialClusterCard({ card, theme, density, onPointerDown }: WidgetCardProps) {
  const pct = clampProgress(card.progress);
  const sizeMap: Record<string, number> = { "ultra-compact": 48, compact: 68, comfortable: 96 };
  const strokeMap: Record<string, number> = { "ultra-compact": 4, compact: 5, comfortable: 7 };
  const size = sizeMap[density] ?? 68;
  const strokeWidth = strokeMap[density] ?? 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const center = size / 2;

  return (
    <section
      className={`widget-card widget-card--dial${card.tone === "muted" ? " is-muted" : ""}`}
      aria-label={card.title}
      onPointerDown={onPointerDown}
    >
      <div className="widget-card__dial-ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="widget-card__dial-svg">
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            stroke="var(--widget-card-progress-track)"
            strokeWidth={strokeWidth}
          />
          {card.progress != null && (
            <circle
              cx={center} cy={center} r={radius}
              fill="none"
              stroke="var(--widget-card-accent)"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="widget-card__dial-arc"
              style={{ filter: `drop-shadow(0 0 6px var(--widget-card-accent))` }}
            />
          )}
        </svg>
        <div className="widget-card__dial-value">
          {card.progress != null ? (
            <span className="widget-card__primary widget-card__primary--dial">{Math.round(pct)}%</span>
          ) : (
            <span className="widget-card__primary widget-card__primary--dial">{card.primary}</span>
          )}
        </div>
      </div>
      <div className="widget-card__dial-label">
        <span className="widget-card__icon widget-card__icon--dial">{card.icon}</span>
        <span className="widget-card__title widget-card__title--dial">{compactLabel(card, theme)}</span>
      </div>
    </section>
  );
}

export function WidgetCard({ card, density, theme, onPointerDown }: WidgetCardProps) {
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
      {theme.layoutFamily === "meter-column" ? (
        <MeterColumnCard card={card} theme={theme} onPointerDown={onPointerDown} />
      ) : theme.layoutFamily === "micro-rail" ? (
        <MicroRailCard card={card} theme={theme} onPointerDown={onPointerDown} />
      ) : theme.layoutFamily === "telemetry-panel" ? (
        <TelemetryPanelCard card={card} theme={theme} onPointerDown={onPointerDown} />
      ) : theme.layoutFamily === "matrix-rain" ? (
        <MatrixRainCard card={card} theme={theme} onPointerDown={onPointerDown} />
      ) : theme.layoutFamily === "dial-cluster" ? (
        <DialClusterCard card={card} density={density} theme={theme} onPointerDown={onPointerDown} />
      ) : (
        <SlabStackCard card={card} theme={theme} onPointerDown={onPointerDown} />
      )}
    </div>
  );
}
