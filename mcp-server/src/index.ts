import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetchClaude, fetchCodex, fetchCursor, fetchBilling, postOpen, type FetchResult } from "./api.js";
import type {
  UsageUpdate,
  CodexUpdate,
  CursorUpdate,
  BillingUpdate,
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
  out += `  --- Account / plan ---\n`;
  if (d.email) out += `  email: ${d.email}\n`;
  if (d.plan_name) out += `  plan_name: ${d.plan_name}\n`;
  if (d.plan_price) out += `  plan_price: ${d.plan_price}\n`;
  if (d.plan_included_amount_cents != null) {
    out += `  plan_included_amount_cents: ${d.plan_included_amount_cents}\n`;
  }
  out += `  is_team: ${d.is_team}\n`;
  if (d.membership_type) out += `  membership_type: ${d.membership_type}\n`;
  if (d.subscription_status) out += `  subscription_status: ${d.subscription_status}\n`;

  out += `\n  --- Spend meter ---\n`;
  out += `  current_spend_cents (included): ${d.current_spend_cents}\n`;
  out += `  limit_cents: ${d.limit_cents}\n`;
  if (d.plan_remaining_cents != null) out += `  plan_remaining_cents: ${d.plan_remaining_cents}\n`;
  out += `  spend_pct: ${pct(d.spend_pct)}\n`;
  if (d.total_spend_cents != null) out += `  total_spend_cents: ${d.total_spend_cents}\n`;
  if (d.bonus_spend_cents != null) out += `  bonus_spend_cents: ${d.bonus_spend_cents}\n`;
  if (d.auto_pct != null) out += `  auto_pct: ${pct(d.auto_pct)}\n`;
  if (d.api_pct != null) out += `  api_pct: ${pct(d.api_pct)}\n`;
  out += `  remaining_bonus: ${d.remaining_bonus}\n`;
  if (d.bonus_tooltip) out += `  bonus_tooltip: ${d.bonus_tooltip}\n`;
  if (d.display_message) out += `  display_message: ${d.display_message}\n`;
  if (d.usage_meter_enabled != null) out += `  usage_meter_enabled: ${d.usage_meter_enabled}\n`;
  if (d.display_threshold_bp != null) out += `  display_threshold_bp: ${d.display_threshold_bp}\n`;
  if (d.auto_model_selected_display_message) {
    out += `  auto_model_selected_display_message: ${d.auto_model_selected_display_message}\n`;
  }
  if (d.named_model_selected_display_message) {
    out += `  named_model_selected_display_message: ${d.named_model_selected_display_message}\n`;
  }

  out += `\n  --- On-demand ---\n`;
  if (d.on_demand_limit_type) out += `  on_demand_limit_type: ${d.on_demand_limit_type}\n`;
  if (d.on_demand_used_cents != null) out += `  on_demand_used_cents: ${d.on_demand_used_cents}\n`;
  if (d.on_demand_limit_cents != null) out += `  on_demand_limit_cents: ${d.on_demand_limit_cents}\n`;
  if (d.on_demand_remaining_cents != null) {
    out += `  on_demand_remaining_cents: ${d.on_demand_remaining_cents}\n`;
  }
  if (d.on_demand_pooled_used_cents != null) {
    out += `  on_demand_pooled_used_cents: ${d.on_demand_pooled_used_cents}\n`;
  }
  if (d.on_demand_pooled_limit_cents != null) {
    out += `  on_demand_pooled_limit_cents: ${d.on_demand_pooled_limit_cents}\n`;
  }
  if (d.on_demand_pooled_remaining_cents != null) {
    out += `  on_demand_pooled_remaining_cents: ${d.on_demand_pooled_remaining_cents}\n`;
  }

  out += `\n  --- Stripe / cycle ---\n`;
  if (d.stripe_balance_cents != null && d.stripe_balance_cents !== 0) {
    out += `  stripe_balance_cents (prepaid credit): ${d.stripe_balance_cents}\n`;
  }
  if (d.billing_cycle_start) out += `  billing_cycle_start: ${d.billing_cycle_start}\n`;
  if (d.cycle_resets_at) {
    out += `  cycle_resets_at: ${d.cycle_resets_at} (in ${resetLabel(d.cycle_resets_at)})\n`;
  }

  if (d.connect_extras && Object.keys(d.connect_extras).length > 0) {
    out += `\n  --- connect_extras (Connect RPC payloads) ---\n`;
    out += `  ${JSON.stringify(d.connect_extras, null, 2).split("\n").join("\n  ")}\n`;
  }
  if (d.enterprise_usage && Object.keys(d.enterprise_usage).length > 0) {
    out += `\n  --- enterprise_usage (cursor.com/api/usage) ---\n`;
    out += `  ${JSON.stringify(d.enterprise_usage, null, 2).split("\n").join("\n  ")}\n`;
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
    const [claude, codex, cursor, billing] = await Promise.all([
      fetchClaude(),
      fetchCodex(),
      fetchCursor(),
      fetchBilling(),
    ]);

    let text = "=== UsageWatch — AI Provider Usage ===\n\n";

    if (claude.status === "ok") {
      text += formatClaude(claude.data);
      // Append billing summary inline
      if (billing.status === "ok" && billing.data.data) {
        const b = billing.data.data;
        if (b.prepaid_credits) {
          text += `  Prepaid balance: ${cents(b.prepaid_credits.amount)}\n`;
        }
        if (b.credit_grant?.granted) {
          text += `  Promotion credit: ${cents(b.credit_grant.amount_minor_units)}\n`;
        }
      }
      text += "\n";
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
  "Get detailed Cursor usage from UsageWatch (same sources as OpenUsage: api2 Connect RPC + cursor.com). Includes plan, spend, percents, on-demand, Stripe balance, billing cycle, and raw connect_extras / enterprise_usage when present.",
  {},
  async () => {
    const result = await fetchCursor();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: errorMessage("CURSOR", result).trim() }] };
    }
    return { content: [{ type: "text", text: formatCursor(result.data).trim() }] };
  }
);

server.tool(
  "get_cursor_usage_json",
  "Same Cursor snapshot as get_cursor_usage but as JSON (full CursorUpdate: data, error, timestamp) for programmatic parsing.",
  {},
  async () => {
    const result = await fetchCursor();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: JSON.stringify({ error: errorMessage("CURSOR", result).trim() }) }] };
    }
    const text = JSON.stringify(result.data, null, 2);
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "get_claude_billing",
  "Get Claude billing details: prepaid credits balance, promotion credit, and extra-usage bundle reset date.",
  {},
  async () => {
    const result = await fetchBilling();
    if (result.status !== "ok") {
      return { content: [{ type: "text", text: errorMessage("CLAUDE BILLING", result).trim() }] };
    }
    const update = result.data;
    if (update.error && !update.data) {
      return { content: [{ type: "text", text: `CLAUDE BILLING (error at ${update.timestamp}):\n  ${update.error}` }] };
    }
    const d = update.data!;
    let out = `CLAUDE BILLING (as of ${update.timestamp}):\n`;

    if (d.prepaid_credits) {
      out += `  Prepaid balance: ${cents(d.prepaid_credits.amount)}\n`;
    } else {
      out += `  Prepaid balance: none\n`;
    }

    if (d.credit_grant?.granted) {
      out += `  Promotion credit: ${cents(d.credit_grant.amount_minor_units)}\n`;
    }

    if (d.bundles) {
      if (d.bundles.purchases_reset_at) {
        out += `  Extra-usage resets: ${new Date(d.bundles.purchases_reset_at).toLocaleDateString()}\n`;
      }
      out += `  Bundle paid this month: ${cents(d.bundles.bundle_paid_this_month_minor_units)}\n`;
      out += `  Bundle monthly cap: ${cents(d.bundles.bundle_monthly_cap_minor_units)}\n`;
    }

    return { content: [{ type: "text", text: out.trim() }] };
  }
);

server.tool(
  "open_app",
  "Show and focus the UsageWatch app window.",
  {},
  async () => {
    const result = await postOpen();
    if (result.status === "ok") {
      return { content: [{ type: "text", text: "UsageWatch window opened." }] };
    }
    if (result.status === "app_not_running") {
      return { content: [{ type: "text", text: "UsageWatch app is not running. Launch it first." }] };
    }
    return { content: [{ type: "text", text: `Failed to open window: HTTP ${result.code}` }] };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
