import { useMemo } from "react";
import { useWidget } from "../context/WidgetContext";
import type { CompactWidgetCard } from "../types/widget";
import { formatCountdown, formatCurrencyFromCents, formatResetDate, getUsageColor } from "../utils/format";

function clampProgress(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(value, 100));
}

function providerBadge(provider: CompactWidgetCard["provider"]) {
  switch (provider) {
    case "Claude":
      return { text: "Cl", accent: "#ff7b57" };
    case "Codex":
      return { text: "Co", accent: "#65a9ff" };
    case "Cursor":
      return { text: "Cu", accent: "#28d07c" };
  }
}

export function ReferenceGlassWidget() {
  const { state } = useWidget();
  const { activeProvider, layout } = state;
  const { preferences } = layout;

  const cards = useMemo<CompactWidgetCard[]>(() => {
    const statusHealthy = (state.status?.indicator ?? "none") === "none";

    if (activeProvider === "Claude") {
      const sessionPct = clampProgress(state.usageData?.five_hour?.utilization);
      const weeklyPct = clampProgress(state.usageData?.seven_day?.utilization);
      const extraPct = clampProgress(state.usageData?.extra_usage?.utilization);
      const base: CompactWidgetCard[] = [
        {
          id: "claude-session",
          provider: "Claude",
          badgeText: "5H",
          accent: sessionPct == null ? "#8b98a7" : getUsageColor(sessionPct),
          title: "Session",
          primary: sessionPct == null ? "--" : `${Math.round(sessionPct)}% used`,
          secondary: `Resets ${formatCountdown(state.usageData?.five_hour?.resets_at ?? null)}`,
          progress: sessionPct,
        },
        {
          id: "claude-weekly",
          provider: "Claude",
          badgeText: "7D",
          accent: weeklyPct == null ? "#8b98a7" : getUsageColor(weeklyPct),
          title: "Weekly",
          primary: weeklyPct == null ? "--" : `${Math.round(weeklyPct)}% used`,
          secondary: `Resets ${formatResetDate(state.usageData?.seven_day?.resets_at ?? null) || "--"}`,
          progress: weeklyPct,
        },
      ];

      if (preferences.claude.showExtra) {
        base.push({
          id: "claude-extra",
          provider: "Claude",
          badgeText: "$",
          accent: "#ffb020",
          title: "Extra Usage",
          primary: `${formatCurrencyFromCents(state.usageData?.extra_usage?.used_credits ?? 0)} / ${formatCurrencyFromCents(state.usageData?.extra_usage?.monthly_limit ?? 0)}`,
          secondary: "Monthly spend",
          progress: extraPct,
          span: 2,
        });
      }

      if (preferences.claude.showBalance) {
        base.push({
          id: "claude-balance",
          provider: "Claude",
          badgeText: "B",
          accent: "#69d7b1",
          title: "Prepaid",
          primary: formatCurrencyFromCents(state.billingData?.prepaid_credits?.amount ?? 0),
          secondary: "Account balance",
        });
      }

      if (preferences.claude.showStatus) {
        base.push({
          id: "claude-status",
          provider: "Claude",
          badgeText: statusHealthy ? "OK" : "!",
          accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
          title: "Status",
          primary: statusHealthy ? "Online" : "Issue",
          secondary: state.status?.description ?? "All systems operational",
          tone: "muted",
        });
      }

      return base;
    }

    if (activeProvider === "Codex") {
      const sessionPct = clampProgress(state.codexData?.session_window?.used_percent);
      const weeklyPct = clampProgress(state.codexData?.weekly_window?.used_percent);
      const base: CompactWidgetCard[] = [
        {
          id: "codex-session",
          provider: "Codex",
          badgeText: "5H",
          accent: "#65a9ff",
          title: "Session",
          primary: sessionPct == null ? "--" : `${Math.round(sessionPct)}% used`,
          secondary: `Resets ${formatCountdown(state.codexData?.session_window?.resets_at ?? null)}`,
          progress: sessionPct,
        },
        {
          id: "codex-weekly",
          provider: "Codex",
          badgeText: "7D",
          accent: "#78c1ff",
          title: "Weekly",
          primary: weeklyPct == null ? "--" : `${Math.round(weeklyPct)}% used`,
          secondary: `Resets ${formatResetDate(state.codexData?.weekly_window?.resets_at ?? null) || "--"}`,
          progress: weeklyPct,
        },
      ];

      if (preferences.codex.showCredits) {
        base.push({
          id: "codex-credits",
          provider: "Codex",
          badgeText: "$",
          accent: state.codexData?.credits?.unlimited ? "#c7f36b" : "#ffb020",
          title: "Credits",
          primary: state.codexData?.credits?.unlimited
            ? "Unlimited"
            : state.codexData?.credits?.balance
              ? `$${state.codexData.credits.balance}`
              : "$0.00",
          secondary: "Available balance",
          span: 2,
        });
      }

      if (preferences.codex.showStatus) {
        base.push({
          id: "codex-status",
          provider: "Codex",
          badgeText: statusHealthy ? "OK" : "!",
          accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
          title: "Status",
          primary: statusHealthy ? "Online" : "Issue",
          secondary: state.status?.description ?? "All systems operational",
          tone: "muted",
          span: 2,
        });
      }

      return base;
    }

    const spendPct = clampProgress(state.cursorData?.spend_pct);
    const base: CompactWidgetCard[] = [
      {
        id: "cursor-spend",
        provider: "Cursor",
        badgeText: "$",
        accent: "#28d07c",
        title: "Spend",
        primary: `${formatCurrencyFromCents(state.cursorData?.current_spend_cents ?? 0)} / ${formatCurrencyFromCents(state.cursorData?.hard_limit_cents ?? 0)}`,
        secondary: `Resets ${formatResetDate(state.cursorData?.cycle_resets_at ?? null) || "--"}`,
        progress: spendPct,
        span: 2,
      },
    ];

    if (preferences.cursor.showStatus) {
      base.push({
        id: "cursor-status",
        provider: "Cursor",
        badgeText: statusHealthy ? "OK" : "!",
        accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
        title: "Status",
        primary: statusHealthy ? "Online" : "Issue",
        secondary: state.status?.description ?? "All systems operational",
        tone: "muted",
        span: 2,
      });
    }

    return base;
  }, [activeProvider, layout.preferences, state]);

  const identity = providerBadge(activeProvider);
  const densityClass = `reference-widget--${layout.preferences.density}`;

  return (
    <div className={`reference-widget ${densityClass}`} role="presentation">
      <header className="reference-widget__identity">
        <div className="reference-widget__identity-badge" style={{ backgroundColor: identity.accent }}>
          {identity.text}
        </div>
        <div className="reference-widget__identity-copy">
          <span className="reference-widget__identity-label">{activeProvider}</span>
          <span className="reference-widget__identity-sub">Focus-aware dashboard</span>
        </div>
      </header>

      <div className="reference-widget__grid">
        {cards.map((card) => (
          <section
            key={card.id}
            className={`reference-card reference-card--span-${card.span ?? 1}${card.tone === "muted" ? " is-muted" : ""}`}
            aria-label={card.title}
          >
            <div className="reference-card__badge" style={{ backgroundColor: card.accent }}>
              {card.badgeText}
            </div>
            <div className="reference-card__title">{card.title}</div>
            <div className="reference-card__primary">{card.primary}</div>
            {card.secondary && <div className="reference-card__secondary">{card.secondary}</div>}
            {card.progress != null && (
              <div className="reference-card__progress">
                <div
                  className="reference-card__progress-fill"
                  style={{ width: `${card.progress}%`, backgroundColor: card.accent }}
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
