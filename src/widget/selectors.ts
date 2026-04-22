import type { BillingInfo, CodexUsageData, CursorUsageData, Provider, UsageData } from "../types/usage";
import type {
  APIStatus,
  WidgetCardDefinition,
  WidgetCardId,
  WidgetCardViewModel,
  WidgetOverlayLayout,
} from "../types/widget";
import { formatCountdown, formatCurrencyFromCents, formatResetDate, getUsageColor } from "../utils/format";

export interface WidgetDataSnapshot {
  usageData: UsageData | null;
  codexData: CodexUsageData | null;
  cursorData: CursorUsageData | null;
  billingData: BillingInfo | null;
  status: APIStatus | null;
  activeProvider: Provider;
}

function clampProgress(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(value, 100));
}

function buildResetDetail(resetAt: string | null | undefined) {
  const formattedTime = formatResetDate(resetAt ?? null) || "--";
  const countdown = formatCountdown(resetAt ?? null);
  return {
    secondary: `Resets ${formattedTime}`,
    secondaryCountdown: `Resets ${countdown}`,
    secondaryBoth: `Resets ${formattedTime} · ${countdown}`,
  };
}

function buildClaudeCards(snapshot: WidgetDataSnapshot): WidgetCardDefinition[] {
  const sessionPct = clampProgress(snapshot.usageData?.five_hour?.utilization);
  const weeklyPct = clampProgress(snapshot.usageData?.seven_day?.utilization);
  const extraPct = clampProgress(snapshot.usageData?.extra_usage?.utilization);
  const statusHealthy = (snapshot.status?.indicator ?? "none") === "none";
  const sessionReset = buildResetDetail(snapshot.usageData?.five_hour?.resets_at);
  const weeklyReset = buildResetDetail(snapshot.usageData?.seven_day?.resets_at);

  return [
    {
      id: "session",
      provider: "Claude",
      icon: "5H",
      shortTitle: "5H",
      accent: sessionPct == null ? "#8390a0" : getUsageColor(sessionPct),
      title: "Session",
      primary: sessionPct == null ? "--" : `${Math.round(sessionPct)}% used`,
      ...sessionReset,
      progress: sessionPct,
    },
    {
      id: "weekly",
      provider: "Claude",
      icon: "7D",
      shortTitle: "7D",
      accent: weeklyPct == null ? "#8390a0" : getUsageColor(weeklyPct),
      title: "Weekly",
      primary: weeklyPct == null ? "--" : `${Math.round(weeklyPct)}% used`,
      ...weeklyReset,
      progress: weeklyPct,
    },
    {
      id: "extra",
      provider: "Claude",
      icon: "$",
      shortTitle: "XTR",
      accent: "#ffb020",
      title: "Extra Usage",
      primary: `${formatCurrencyFromCents(snapshot.usageData?.extra_usage?.used_credits ?? 0)} / ${formatCurrencyFromCents(snapshot.usageData?.extra_usage?.monthly_limit ?? 0)}`,
      secondary: "Monthly spend",
      progress: extraPct,
    },
    {
      id: "balance",
      provider: "Claude",
      icon: "B",
      shortTitle: "BAL",
      accent: "#69d7b1",
      title: "Prepaid",
      primary: formatCurrencyFromCents(snapshot.billingData?.prepaid_credits?.amount ?? 0),
      secondary: "Account balance",
    },
    (() => {
      const designPct = clampProgress(snapshot.usageData?.seven_day_omelette?.utilization);
      return {
        id: "design" as const,
        provider: "Claude" as const,
        icon: "Dz",
        shortTitle: "DZN",
        accent: "#a78bfa",
        title: "Design 7D",
        primary: designPct == null ? "--" : `${Math.round(designPct)}% used`,
        ...buildResetDetail(snapshot.usageData?.seven_day_omelette?.resets_at),
        progress: designPct,
      };
    })(),
    {
      id: "status",
      provider: "Claude",
      icon: statusHealthy ? "OK" : "!",
      shortTitle: "API",
      accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
      title: "Status",
      primary: statusHealthy ? "Online" : "Issue",
      secondary: snapshot.status?.description ?? "All systems operational",
      tone: "muted",
    },
  ];
}

function buildCodexCards(snapshot: WidgetDataSnapshot): WidgetCardDefinition[] {
  const sessionPct = clampProgress(snapshot.codexData?.session_window?.used_percent);
  const weeklyPct = clampProgress(snapshot.codexData?.weekly_window?.used_percent);
  const statusHealthy = (snapshot.status?.indicator ?? "none") === "none";
  const sessionReset = buildResetDetail(snapshot.codexData?.session_window?.resets_at);
  const weeklyReset = buildResetDetail(snapshot.codexData?.weekly_window?.resets_at);

  return [
    {
      id: "session",
      provider: "Codex",
      icon: "5H",
      shortTitle: "5H",
      accent: "#65a9ff",
      title: "Session",
      primary: sessionPct == null ? "--" : `${Math.round(sessionPct)}% used`,
      ...sessionReset,
      progress: sessionPct,
    },
    {
      id: "weekly",
      provider: "Codex",
      icon: "7D",
      shortTitle: "7D",
      accent: "#78c1ff",
      title: "Weekly",
      primary: weeklyPct == null ? "--" : `${Math.round(weeklyPct)}% used`,
      ...weeklyReset,
      progress: weeklyPct,
    },
    {
      id: "credits",
      provider: "Codex",
      icon: "$",
      shortTitle: "CRD",
      accent: snapshot.codexData?.credits?.unlimited ? "#c7f36b" : "#ffb020",
      title: "Credits",
      primary: snapshot.codexData?.credits?.unlimited
        ? "Unlimited"
        : snapshot.codexData?.credits?.balance
          ? `$${snapshot.codexData.credits.balance}`
          : "$0.00",
      secondary: "Available balance",
    },
    {
      id: "status",
      provider: "Codex",
      icon: statusHealthy ? "OK" : "!",
      shortTitle: "API",
      accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
      title: "Status",
      primary: statusHealthy ? "Online" : "Issue",
      secondary: snapshot.status?.description ?? "All systems operational",
      tone: "muted",
    },
  ];
}

function buildCursorCards(snapshot: WidgetDataSnapshot): WidgetCardDefinition[] {
  const spendPct = clampProgress(snapshot.cursorData?.spend_pct);
  const statusHealthy = (snapshot.status?.indicator ?? "none") === "none";
  const cycleReset = buildResetDetail(snapshot.cursorData?.cycle_resets_at);

  return [
    {
      id: "session",
      provider: "Cursor",
      icon: "$",
      shortTitle: "SPD",
      accent: "#28d07c",
      title: "Spend",
      primary: `${formatCurrencyFromCents(snapshot.cursorData?.current_spend_cents ?? 0)} / ${formatCurrencyFromCents(snapshot.cursorData?.limit_cents ?? 0)}`,
      ...cycleReset,
      progress: spendPct,
    },
    {
      id: "status",
      provider: "Cursor",
      icon: statusHealthy ? "OK" : "!",
      shortTitle: "API",
      accent: statusHealthy ? "#6ce7bd" : "#ff7d7d",
      title: "Status",
      primary: statusHealthy ? "Online" : "Issue",
      secondary: snapshot.status?.description ?? "All systems operational",
      tone: "muted",
    },
  ];
}

export function selectWidgetCardModels(
  snapshot: WidgetDataSnapshot,
  layout: WidgetOverlayLayout,
): WidgetCardViewModel[] {
  const provider = snapshot.activeProvider;
  const definitions =
    provider === "Claude"
      ? buildClaudeCards(snapshot)
      : provider === "Codex"
        ? buildCodexCards(snapshot)
        : buildCursorCards(snapshot);

  const byId = new Map<WidgetCardId, WidgetCardDefinition>();
  for (const definition of definitions) {
    byId.set(definition.id, definition);
  }

  return layout.cardOrder
    .map((id) => {
      const definition = byId.get(id);
      if (!definition) return null;
      return {
        ...definition,
        visible: layout.cardVisibility[provider][id],
      } satisfies WidgetCardViewModel;
    })
    .filter((card): card is WidgetCardViewModel => card !== null);
}
