import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetchClaude, fetchCodex, fetchCursor, type FetchResult } from "./api.js";
import type {
  UsageUpdate,
  CodexUpdate,
  CursorUpdate,
  UsageWindow,
  CodexUsageWindow,
} from "./types.js";

// ── Formatting helpers ───────────────────────────────────────────────────────

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function cents(v: number): string {
  return `$${(v / 100).toFixed(2)}`;
}

function resetLabel(iso: string | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return "now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function windowLine(label: string, w: UsageWindow | undefined): string {
  if (!w) return "";
  const reset = w.resets_at ? `, resets in ${resetLabel(w.resets_at)}` : "";
  return `  ${label}: ${pct(w.utilization)} used${reset}\n`;
}

function codexWindowLine(label: string, w: CodexUsageWindow | undefined): string {
  if (!w) return "";
  const reset = w.resets_at ? `, resets in ${resetLabel(w.resets_at)}` : "";
  return `  ${label}: ${pct(w.used_percent)} used${reset}\n`;
}

function errorMessage(provider: string, result: FetchResult<unknown>): string {
  switch (result.status) {
    case "app_not_running":
      return `${provider}: UsageWatch app is not running. Launch it to get usage data.\n`;
    case "unavailable":
      return `${provider}: Not connected in UsageWatch. Set up credentials in the app.\n`;
    case "http_error":
      return `${provider}: HTTP error ${result.code} from UsageWatch API.\n`;
    default:
      return "";
  }
}

// ── Provider formatters ──────────────────────────────────────────────────────

function formatClaude(update: UsageUpdate): string {
  if (update.error && !update.data) {
    return `CLAUDE (error at ${update.timestamp}):\n  ${update.error}\n`;
  }
  const d = update.data!;
  let out = `CLAUDE (as of ${update.timestamp}):\n`;
  out += windowLine("Session (5h)", d.five_hour);
  out += windowLine("Weekly (7d)", d.seven_day);
  out += windowLine("Weekly Opus", d.seven_day_opus);
  out += windowLine("Weekly Sonnet", d.seven_day_sonnet);
  out += windowLine("Weekly OAuth Apps", d.seven_day_oauth_apps);
  out += windowLine("Weekly Cowork", d.seven_day_cowork);
  if (d.extra_usage?.is_enabled) {
    const e = d.extra_usage;
    out += `  Extra usage: ${pct(e.utilization)} (${cents(e.used_credits)} / ${cents(e.monthly_limit)})\n`;
  }
  if (update.peak_hours) {
    const ph = update.peak_hours;
    const label = ph.is_weekend ? "weekend" : ph.is_off_peak ? "off-peak" : "peak";
    out += `  Peak hours: ${label}\n`;
  }
  return out;
}

function formatCodex(update: CodexUpdate): string {
  if (update.error && !update.data) {
    return `CODEX (error at ${update.timestamp}):\n  ${update.error}\n`;
  }
  const d = update.data!;
  let out = `CODEX (as of ${update.timestamp}):\n`;
  if (d.plan_type) out += `  Plan: ${d.plan_type}\n`;
  if (d.limit_reached) out += `  ⚠ Rate limit reached\n`;
  out += codexWindowLine("Session", d.session_window);
  out += codexWindowLine("Weekly", d.weekly_window);
  out += codexWindowLine("Code Review", d.code_review_window);
  if (d.credits) {
    const c = d.credits;
    if (c.unlimited) {
      out += `  Credits: unlimited\n`;
    } else if (c.balance) {
      out += `  Credits: ${c.balance} remaining${c.overage_limit_reached ? " (overage limit reached)" : ""}\n`;
    }
  }
  return out;
}

function formatCursor(update: CursorUpdate): string {
  if (update.error && !update.data) {
    return `CURSOR (error at ${update.timestamp}):\n  ${update.error}\n`;
  }
  const d = update.data!;
  let out = `CURSOR (as of ${update.timestamp}):\n`;
  if (d.email) out += `  Account: ${d.email}\n`;
  if (d.plan_name) out += `  Plan: ${d.plan_name}${d.plan_price ? ` (${d.plan_price})` : ""}${d.is_team ? " [Team]" : ""}\n`;
  out += `  Included spend: ${cents(d.current_spend_cents)} / ${cents(d.limit_cents)} (${pct(d.spend_pct)})\n`;
  if (d.auto_pct != null) out += `  Auto mode: ${pct(d.auto_pct)}\n`;
  if (d.api_pct != null) out += `  API/manual: ${pct(d.api_pct)}\n`;
  if (d.on_demand_used_cents != null && d.on_demand_limit_cents != null) {
    out += `  On-demand: ${cents(d.on_demand_used_cents)} / ${cents(d.on_demand_limit_cents)}`;
    if (d.on_demand_remaining_cents != null) out += ` (${cents(d.on_demand_remaining_cents)} remaining)`;
    out += "\n";
  }
  if (d.on_demand_pooled_used_cents != null && d.on_demand_pooled_limit_cents != null) {
    out += `  Pooled on-demand: ${cents(d.on_demand_pooled_used_cents)} / ${cents(d.on_demand_pooled_limit_cents)}`;
    if (d.on_demand_pooled_remaining_cents != null) out += ` (${cents(d.on_demand_pooled_remaining_cents)} remaining)`;
    out += "\n";
  }
  if (d.stripe_balance_cents != null && d.stripe_balance_cents !== 0) {
    out += `  Prepaid balance: ${cents(d.stripe_balance_cents)}\n`;
  }
  if (d.remaining_bonus) out += `  Bonus credits: available\n`;
  if (d.cycle_resets_at) out += `  Cycle resets in ${resetLabel(d.cycle_resets_at)}\n`;
  if (d.subscription_status && d.subscription_status !== "active") {
    out += `  Subscription: ${d.subscription_status}\n`;
  }
  return out;
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "usagewatch",
  version: "0.1.0",
});

server.tool(
  "get_usage_overview",
  "Get a combined usage summary across all AI providers (Claude, Codex, Cursor) from UsageWatch. Shows rate-limit percentages, spend, and reset times.",
  {},
  async () => {
    const [claude, codex, cursor] = await Promise.all([
      fetchClaude(),
      fetchCodex(),
      fetchCursor(),
    ]);

    let text = "=== UsageWatch — AI Provider Usage ===\n\n";

    if (claude.status === "ok") {
      text += formatClaude(claude.data) + "\n";
    } else {
      text += errorMessage("CLAUDE", claude) + "\n";
    }

    if (codex.status === "ok") {
      text += formatCodex(codex.data) + "\n";
    } else {
      text += errorMessage("CODEX", codex) + "\n";
    }

    if (cursor.status === "ok") {
      text += formatCursor(cursor.data) + "\n";
    } else {
      text += errorMessage("CURSOR", cursor) + "\n";
    }

    return { content: [{ type: "text", text: text.trimEnd() }] };
  }
);

server.tool(
  "get_claude_usage",
  "Get detailed Claude usage: session (5h) and weekly (7d) rate limits by model, extra usage spend, peak hours status, and reset timers.",
  {},
  async () => {
    const result = await fetchClaude();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: errorMessage("CLAUDE", result).trim() }] };
    }
    return { content: [{ type: "text", text: formatClaude(result.data).trim() }] };
  }
);

server.tool(
  "get_codex_usage",
  "Get detailed Codex (OpenAI) usage: session and weekly rate limits, code review limits, credit balance, and plan type.",
  {},
  async () => {
    const result = await fetchCodex();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: errorMessage("CODEX", result).trim() }] };
    }
    return { content: [{ type: "text", text: formatCodex(result.data).trim() }] };
  }
);

server.tool(
  "get_cursor_usage",
  "Get detailed Cursor usage: plan spend vs limit, on-demand usage, bonus credits, billing cycle, and subscription status.",
  {},
  async () => {
    const result = await fetchCursor();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: errorMessage("CURSOR", result).trim() }] };
    }
    return { content: [{ type: "text", text: formatCursor(result.data).trim() }] };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
