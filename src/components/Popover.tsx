import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUsageData } from "../hooks/useUsageData";
import { useHistoryRecorder } from "../hooks/useHistoryRecorder";
import { useBurnRate } from "../hooks/useBurnRate";
import { useAlertEngine } from "../hooks/useAlertEngine";
import { useApp } from "../context/AppContext";
import { UsageBar } from "./UsageBar";
import { HistoryChart } from "./HistoryChart";
import { StatusIndicator } from "./StatusIndicator";
import { formatCurrencyFromCents, formatTimestamp } from "../utils/format";
import type { BillingInfo } from "../types/usage";
import { CursorConnectExtrasFriendly, CursorEnterpriseUsageFriendly } from "./CursorExtrasFriendly";

export function Popover() {
  const { usageData, lastUpdated, error, isLoading, isOffline, refresh } = useUsageData();
  const { state, dispatch } = useApp();
  const { show_remaining } = state.settings;
  const { codexData, codexError, codexLastUpdated, cursorData, cursorError, cursorLastUpdated, peakHours } = state;
  const [activeTab, setActiveTab] = useState<'claude' | 'codex' | 'cursor'>('claude');
  const [showHistory, setShowHistory] = useState(false);
  const hasCodex = !!(codexData || codexError);
  const hasCursor = !!(cursorData || cursorError);
  // Track which providers are configured (auth exists) so tabs are stable from
  // the start — without this they only appear after the first poll completes.
  const [codexConfigured, setCodexConfigured] = useState(hasCodex);
  const [cursorConfigured, setCursorConfigured] = useState(hasCursor);

  useEffect(() => {
    invoke<boolean>("check_codex_auth").then((ok) => { if (ok) setCodexConfigured(true); }).catch(() => {});
    invoke<boolean>("check_cursor_auth").then((ok) => { if (ok) setCursorConfigured(true); }).catch(() => {});
  }, []);

  // Keep configured flags in sync if data arrives after the initial check
  useEffect(() => { if (hasCodex) setCodexConfigured(true); }, [hasCodex]);
  useEffect(() => { if (hasCursor) setCursorConfigured(true); }, [hasCursor]);

  const showTabs = codexConfigured || cursorConfigured;
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [pinned, setPinned] = useState(true);

  const hideWindow = () => getCurrentWindow().hide();
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
    e.preventDefault();
    getCurrentWindow().startDragging();
  };

  // Hide window when it loses focus (clicking outside) — unless pinned
  // Uses a guard to ignore focus loss right after the window opens
  const focusGuard = useRef(false);

  useEffect(() => {
    const unlistenOpen = listen("window-opened", () => {
      focusGuard.current = true;
      setTimeout(() => { focusGuard.current = false; }, 300);
    });
    return () => { unlistenOpen.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && !pinned && !focusGuard.current) hideWindow();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [pinned]);

  // Fetch billing info on mount and every 5 minutes
  useEffect(() => {
    async function loadBilling() {
      try {
        const sessionKey = await invoke<string | null>("get_session_key");
        const orgId = await invoke<string | null>("get_org_id");
        if (sessionKey && orgId) {
          const info = await invoke<BillingInfo>("fetch_billing", { sessionKey, orgId });
          setBilling(info);
        }
      } catch {
        // Non-critical — billing info is optional
      }
    }
    loadBilling();
    const interval = setInterval(loadBilling, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Record usage data to SQLite on each update
  useHistoryRecorder(usageData);

  // Calculate burn rate from recorded history
  const burnRate = useBurnRate(
    usageData?.five_hour?.utilization ?? null,
    usageData?.seven_day?.utilization ?? null
  );

  const cursorUsageTone =
    cursorData && cursorData.spend_pct >= 90
      ? "danger"
      : cursorData && cursorData.spend_pct >= 75
        ? "warning"
        : "healthy";
  const cursorPlanLimitCents = cursorData
    ? (cursorData.plan_included_amount_cents ?? cursorData.limit_cents)
    : 0;
  const cursorHasMonetaryPlan = !!cursorData && (
    cursorPlanLimitCents > 0 || cursorData.current_spend_cents > 0 || (cursorData.total_spend_cents ?? 0) > 0
  );
  const cursorNormalizedPlan = cursorData?.plan_name?.trim().toLowerCase() ?? null;
  const cursorNormalizedMembership = cursorData?.membership_type?.trim().toLowerCase() ?? null;
  const cursorNormalizedPrice = cursorData?.plan_price?.trim().toLowerCase() ?? null;
  const cursorShowPlanPrice =
    !!cursorData?.plan_price &&
    cursorNormalizedPrice !== cursorNormalizedPlan &&
    cursorNormalizedPrice !== cursorNormalizedMembership;
  const cursorShowMembership =
    !!cursorData?.membership_type &&
    cursorNormalizedMembership !== cursorNormalizedPlan;
  const cursorOnDemandLimit =
    cursorData?.is_team && (cursorData.on_demand_pooled_limit_cents ?? 0) > 0
      ? cursorData.on_demand_pooled_limit_cents
      : cursorData?.on_demand_limit_cents;
  const cursorOnDemandUsed =
    cursorData?.is_team
      ? cursorData.on_demand_pooled_used_cents ?? cursorData.on_demand_used_cents ?? 0
      : cursorData?.on_demand_used_cents ?? 0;
  const cursorOnDemandScope =
    cursorData?.is_team
      ? "team pool"
      : cursorData?.on_demand_limit_type === "team"
        ? "team cap"
        : "personal cap";

  // Monitor thresholds and fire native notifications
  useAlertEngine(usageData, burnRate);

  return (
    <div className="popover">
      <div className="popover-top" onMouseDown={startDrag}>
        <div className="popover-header">
          <h1 className="popover-title">UsageWatch</h1>
          <div className="popover-actions">
            <button
              className={`icon-btn pin-btn ${pinned ? "active" : ""}`}
              onClick={() => setPinned(!pinned)}
              title={pinned ? "Unpin window" : "Pin window (keep open)"}
            >
              &#x1F4CC;
            </button>
            <button
              className={`icon-btn ${showHistory ? "active" : ""}`}
              onClick={() => setShowHistory(!showHistory)}
              title="History"
            >
              &#x1F4CA;
            </button>
            <button
              className="icon-btn"
              onClick={refresh}
              disabled={isLoading}
              title="Refresh"
            >
              <span className={isLoading ? "spin" : ""}>&#x21bb;</span>
            </button>
            <button
              className="icon-btn"
              onClick={() => dispatch({ type: "SET_VIEW", view: "settings" })}
              title="Settings"
            >
              &#x2699;
            </button>
            <button
              className="icon-btn close-btn"
              onClick={hideWindow}
              title="Close"
            >
              &#x2715;
            </button>
          </div>
        </div>

        <StatusIndicator />
      </div>

      {/* Tab bar — shown as soon as any secondary provider is configured */}
      {showTabs && (
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'claude' ? 'active' : ''}`}
            onClick={() => setActiveTab('claude')}
          >
            Claude
          </button>
          {codexConfigured && (
            <button
              className={`tab-btn ${activeTab === 'codex' ? 'active' : ''}`}
              onClick={() => setActiveTab('codex')}
            >
              Codex
            </button>
          )}
          {cursorConfigured && (
            <button
              className={`tab-btn ${activeTab === 'cursor' ? 'active' : ''}`}
              onClick={() => setActiveTab('cursor')}
            >
              Cursor
            </button>
          )}
        </div>
      )}

      {/* ── Claude tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'claude' && (
        <>
          {isOffline && (
            <div className="status-banner offline">
              Offline — showing last known data
            </div>
          )}

          {error && !usageData && (
            <div className="status-banner error">
              {error}
            </div>
          )}

          {showHistory ? (
            <HistoryChart />
          ) : (
            <>
              {usageData ? (
                <div className="usage-list">
                  {usageData.five_hour && (
                    <div className="usage-section">
                      <h2 className="section-heading">Plan Usage Limits</h2>
                      <UsageBar
                        label="Current Session"
                        percentage={usageData.five_hour.utilization}
                        resetAt={usageData.five_hour.resets_at}
                        showRemaining={show_remaining}
                        estimatedMinsToLimit={burnRate.session_mins_to_limit}
                      />
                    </div>
                  )}

                  {(usageData.seven_day || usageData.seven_day_opus || usageData.seven_day_sonnet || usageData.seven_day_oauth_apps || usageData.seven_day_cowork) && (
                    <div className="usage-section">
                      <h2 className="section-heading">Weekly Limits</h2>
                      {usageData.seven_day && (
                        <UsageBar
                          label="All Models"
                          percentage={usageData.seven_day.utilization}
                          resetAt={usageData.seven_day.resets_at}
                          showRemaining={show_remaining}
                          estimatedMinsToLimit={burnRate.weekly_mins_to_limit}
                        />
                      )}
                      {usageData.seven_day_opus &&
                        usageData.seven_day_opus.utilization > 0 && (
                          <UsageBar
                            label="Opus Only"
                            percentage={usageData.seven_day_opus.utilization}
                            resetAt={usageData.seven_day_opus.resets_at}
                            showRemaining={show_remaining}
                          />
                        )}
                      {usageData.seven_day_sonnet &&
                        usageData.seven_day_sonnet.utilization > 0 && (
                          <UsageBar
                            label="Sonnet Only"
                            percentage={usageData.seven_day_sonnet.utilization}
                            resetAt={usageData.seven_day_sonnet.resets_at}
                            showRemaining={show_remaining}
                          />
                        )}
                      {usageData.seven_day_oauth_apps &&
                        usageData.seven_day_oauth_apps.utilization > 0 && (
                          <UsageBar
                            label="OAuth Apps"
                            percentage={usageData.seven_day_oauth_apps.utilization}
                            resetAt={usageData.seven_day_oauth_apps.resets_at}
                            showRemaining={show_remaining}
                          />
                        )}
                      {usageData.seven_day_cowork &&
                        usageData.seven_day_cowork.utilization > 0 && (
                          <UsageBar
                            label="Cowork"
                            percentage={usageData.seven_day_cowork.utilization}
                            resetAt={usageData.seven_day_cowork.resets_at}
                            showRemaining={show_remaining}
                          />
                        )}
                    </div>
                  )}

                  {peakHours && (
                    <div
                      className="peak-hours-badge"
                      title={
                        peakHours.is_weekend
                          ? "Weekend — Claude API is typically at lower load. Expect faster responses and higher rate limits."
                          : peakHours.is_peak
                          ? "Peak Hours — Claude API is under higher load right now. You may see slower responses or hit rate limits sooner."
                          : "Off-Peak — Claude API is at lower load. Expect faster responses and higher rate limits."
                      }
                    >
                      <span className={`peak-dot ${peakHours.is_peak && !peakHours.is_weekend ? "peak" : "off-peak"}`} />
                      {peakHours.is_weekend
                        ? "Weekend · Off-Peak"
                        : peakHours.is_peak
                        ? "Peak Hours"
                        : "Off-Peak"}
                      <span style={{ opacity: 0.5, fontSize: "9px", marginLeft: 3 }}>ⓘ</span>
                    </div>
                  )}

                  {usageData.extra_usage &&
                    usageData.extra_usage.is_enabled && (
                      <div className="usage-section">
                        <h2 className="section-heading">Extra Usage</h2>
                        <div className="extra-usage">
                          <div className="usage-bar-header">
                            <span className="usage-bar-pct" style={{ color: "#8b5cf6" }}>
                              {(usageData.extra_usage.utilization ?? 0).toFixed(0)}% used
                            </span>
                          </div>
                          <div className="usage-bar-track">
                            <div
                              className="usage-bar-fill"
                              style={{
                                width: `${Math.min(usageData.extra_usage.utilization ?? 0, 100)}%`,
                                backgroundColor: "#8b5cf6",
                              }}
                            />
                          </div>
                          <div className="extra-usage-details">
                            <span>${((usageData.extra_usage.used_credits ?? 0) / 100).toFixed(2)} spent</span>
                            <span>${((usageData.extra_usage.monthly_limit ?? 0) / 100).toFixed(2)} / mo limit</span>
                          </div>
                          {billing?.bundles?.purchases_reset_at && (
                            <div className="extra-usage-reset">
                              Resets {new Date(billing.bundles.purchases_reset_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {billing && (billing.prepaid_credits || billing.credit_grant) && (
                    <div className="usage-section">
                      <h2 className="section-heading">Balance</h2>
                      <div className="billing-cards">
                        {billing.prepaid_credits && (
                          <div className="billing-card">
                            <span className="billing-value">
                              ${(billing.prepaid_credits.amount / 100).toFixed(2)}
                            </span>
                            <span className="billing-label">Current balance</span>
                          </div>
                        )}
                        {billing.credit_grant && billing.credit_grant.granted && (
                          <div className="billing-card">
                            <span className="billing-value credit">
                              ${(billing.credit_grant.amount_minor_units / 100).toFixed(2)}
                            </span>
                            <span className="billing-label">Promotion credit</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                !error && (
                  <div className="loading-state">
                    <p>Waiting for data...</p>
                  </div>
                )
              )}
            </>
          )}

          {lastUpdated && (
            <div className="popover-footer">
              Last updated: {formatTimestamp(lastUpdated)}
            </div>
          )}
        </>
      )}

      {/* ── Codex tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'codex' && (
        <>
          {codexData?.limit_reached && (
            <div className="status-banner error">Rate limit reached</div>
          )}

          <div className="usage-list">
            {codexData ? (
              <>
                {codexData.session_window && (
                  <div className="usage-section">
                    <h2 className="section-heading">
                      Plan Usage Limits
                      {codexData.plan_type && (
                        <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.55, fontWeight: 'normal', textTransform: 'capitalize' }}>
                          {codexData.plan_type}
                        </span>
                      )}
                    </h2>
                    {codexData.account_id && (
                      <div className="extra-usage-details" style={{ marginBottom: '8px' }}>
                        <span title={codexData.account_id}>Account bound</span>
                      </div>
                    )}
                    <UsageBar
                      label="Current Session"
                      percentage={codexData.session_window.used_percent}
                      resetAt={codexData.session_window.resets_at}
                      showRemaining={show_remaining}
                    />
                  </div>
                )}

                {codexData.weekly_window && (
                  <div className="usage-section">
                    <h2 className="section-heading">Weekly Limits</h2>
                    <UsageBar
                      label="All Models"
                      percentage={codexData.weekly_window.used_percent}
                      resetAt={codexData.weekly_window.resets_at}
                      showRemaining={show_remaining}
                    />
                    {codexData.code_review_window &&
                      codexData.code_review_window.used_percent > 0 && (
                        <UsageBar
                          label="Code Review"
                          percentage={codexData.code_review_window.used_percent}
                          resetAt={codexData.code_review_window.resets_at}
                          showRemaining={show_remaining}
                        />
                      )}
                  </div>
                )}

                {codexData.credits?.has_credits && (
                  <div className="usage-section">
                    <h2 className="section-heading">Credits</h2>
                    <div className="billing-cards">
                      <div className="billing-card">
                        <span className="billing-value">
                          ${parseFloat(codexData.credits.balance ?? '0').toFixed(2)}
                        </span>
                        <span className="billing-label">
                          {codexData.credits.overage_limit_reached ? "Balance exhausted" : "Available balance"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {codexData.credits?.unlimited && (
                  <div className="usage-section">
                    <div className="billing-cards">
                      <div className="billing-card">
                        <span className="billing-label">Unlimited plan</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : codexError ? (
              <div className="loading-state">
                <p style={{ fontSize: '12px' }}>{codexError}</p>
              </div>
            ) : (
              <div className="loading-state">
                <p>Waiting for data...</p>
              </div>
            )}
          </div>

          {codexLastUpdated && (
            <div className="popover-footer">
              Last updated: {formatTimestamp(codexLastUpdated)}
            </div>
          )}
        </>
      )}

      {/* ── Cursor tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'cursor' && (
        <>
          <div className="usage-list">
            {cursorData ? (
              <>
                {/* ── Plan usage ── */}
                <div className="usage-section">
                  <h2 className="section-heading">
                    {cursorData.is_team ? 'Team Usage' : 'Plan Usage'}
                    {cursorData.plan_name && (
                      <span className="section-heading-meta section-heading-plan">
                        {cursorData.plan_name}
                      </span>
                    )}
                    {cursorData.email && (
                      <span className="section-heading-meta section-heading-email">
                        {cursorData.email}
                      </span>
                    )}
                  </h2>
                  {(cursorShowPlanPrice || cursorShowMembership || cursorData.subscription_status) && (
                    <div className="extra-usage-details" style={{ marginBottom: '8px' }}>
                      {cursorShowPlanPrice && <span>{cursorData.plan_price}</span>}
                      {cursorShowMembership && <span>Tier {cursorData.membership_type}</span>}
                      {cursorData.subscription_status && <span>{cursorData.subscription_status}</span>}
                    </div>
                  )}

                  <div className="extra-usage cursor-usage-card">
                    <div className="cursor-usage-topline">
                      <div className="cursor-usage-amounts">
                        {cursorHasMonetaryPlan ? (
                          <>
                            <span className="cursor-usage-amount">
                              {formatCurrencyFromCents(cursorData.current_spend_cents)}
                            </span>
                            <span className="cursor-usage-divider">of</span>
                            <span className="cursor-usage-limit">
                              {formatCurrencyFromCents(cursorPlanLimitCents)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="cursor-usage-amount">
                              {cursorData.spend_pct.toFixed(0)}%
                            </span>
                            <span className="cursor-usage-divider">used this cycle</span>
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {cursorData.remaining_bonus && (
                          <span
                            className="cursor-usage-badge"
                            style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}
                            title="Bonus credits from model providers are still available"
                          >
                            +bonus
                          </span>
                        )}
                        {cursorHasMonetaryPlan && (
                          <span className={`cursor-usage-badge ${cursorUsageTone}`}>
                            {cursorData.spend_pct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="usage-bar-track">
                      <div
                        className="usage-bar-fill"
                        style={{
                          width: `${Math.min(cursorData.spend_pct, 100)}%`,
                          backgroundColor: cursorData.spend_pct >= 90 ? 'var(--red)' : cursorData.spend_pct >= 75 ? 'var(--orange)' : 'var(--green)',
                        }}
                      />
                    </div>

                    {/* Auto / API breakdown */}
                    {(cursorData.auto_pct != null || cursorData.api_pct != null) && (
                      <div className="extra-usage-details" style={{ marginTop: '6px' }}>
                        {cursorData.auto_pct != null && (
                          <span title="Usage from Auto mode (Cursor selects the model)">
                            Auto {cursorData.auto_pct.toFixed(1)}%
                          </span>
                        )}
                        {cursorData.api_pct != null && (
                          <span title="Usage from API/manual model selection">
                            API {cursorData.api_pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}

                    {cursorHasMonetaryPlan ? (
                      <div className="extra-usage-details">
                        <span>{formatCurrencyFromCents(cursorData.current_spend_cents)} used</span>
                        <span>{formatCurrencyFromCents(cursorPlanLimitCents)} included</span>
                      </div>
                    ) : (
                      <div className="extra-usage-details">
                        <span>{cursorData.plan_name ?? "Usage tracked by percent"}</span>
                        <span>{cursorData.display_message ?? "Cursor did not return a dollar limit for this plan."}</span>
                      </div>
                    )}
                    {(cursorData.total_spend_cents != null || cursorData.bonus_spend_cents != null) && (
                      <div className="extra-usage-details">
                        {cursorData.total_spend_cents != null && (
                          <span>Total {formatCurrencyFromCents(cursorData.total_spend_cents)}</span>
                        )}
                        {cursorData.bonus_spend_cents != null && (
                          <span title={cursorData.bonus_tooltip ?? "Bonus credits from model providers"}>
                            Bonus {formatCurrencyFromCents(cursorData.bonus_spend_cents)}
                          </span>
                        )}
                      </div>
                    )}
                    {cursorData.display_message && cursorHasMonetaryPlan && (
                      <div className="extra-usage-details">
                        <span>{cursorData.display_message}</span>
                      </div>
                    )}
                    {cursorData.bonus_tooltip && cursorData.remaining_bonus && (
                      <div className="extra-usage-details">
                        <span>{cursorData.bonus_tooltip}</span>
                      </div>
                    )}
                  </div>

                  {cursorData.cycle_resets_at && (
                    <div className="usage-bar-footer" style={{ marginTop: '8px' }}>
                      <span className="usage-bar-reset">
                        Resets {new Date(cursorData.cycle_resets_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>

                {/* ── On-demand budget (shown only when set) ── */}
                {cursorOnDemandLimit != null && (
                  <div className="usage-section">
                    <h2 className="section-heading">
                      On-Demand Budget
                      <span className="section-heading-meta" style={{ opacity: 0.5 }} title="Extra spending after the plan limit is exhausted">
                        {cursorOnDemandScope}
                      </span>
                    </h2>
                    <UsageBar
                      label="Budget used"
                      percentage={
                        cursorOnDemandLimit > 0
                          ? Math.min((cursorOnDemandUsed / cursorOnDemandLimit) * 100, 100)
                          : 0
                      }
                      resetAt={cursorData.cycle_resets_at}
                      showRemaining={show_remaining}
                    />
                    <div className="extra-usage-details" style={{ marginTop: '4px' }}>
                      <span>{formatCurrencyFromCents(cursorOnDemandUsed)} used</span>
                      <span>{formatCurrencyFromCents(cursorOnDemandLimit)} limit</span>
                    </div>
                    {((cursorData.is_team && cursorData.on_demand_pooled_remaining_cents != null)
                      || (!cursorData.is_team && cursorData.on_demand_remaining_cents != null)) && (
                      <div className="extra-usage-details" style={{ marginTop: '4px' }}>
                        <span>
                          {formatCurrencyFromCents(
                            cursorData.is_team
                              ? cursorData.on_demand_pooled_remaining_cents ?? 0
                              : cursorData.on_demand_remaining_cents ?? 0
                          )} remaining
                        </span>
                        {cursorData.is_team && cursorData.on_demand_limit_cents != null && (
                          <span>Personal cap {formatCurrencyFromCents(cursorData.on_demand_limit_cents)}</span>
                        )}
                      </div>
                    )}
                    {cursorData.is_team && cursorData.on_demand_limit_cents != null && cursorData.on_demand_used_cents != null && (
                      <div className="extra-usage-details" style={{ marginTop: '4px' }}>
                        <span>Personal used {formatCurrencyFromCents(cursorData.on_demand_used_cents)}</span>
                        {cursorData.on_demand_remaining_cents != null && (
                          <span>Personal remaining {formatCurrencyFromCents(cursorData.on_demand_remaining_cents)}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Prepaid Stripe balance ── */}
                {cursorData.stripe_balance_cents != null && (
                  <div className="usage-section">
                    <h2 className="section-heading">Prepaid Balance</h2>
                    <div className="billing-cards">
                      <div className="billing-card">
                        <span className="billing-value">
                          {formatCurrencyFromCents(cursorData.stripe_balance_cents)}
                        </span>
                        <span className="billing-label">Available credit</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Connect / enterprise extras (OpenUsage-aligned fetch) ── */}
                {(cursorData.billing_cycle_start ||
                  cursorData.plan_remaining_cents != null ||
                  cursorData.usage_meter_enabled != null ||
                  cursorData.display_threshold_bp != null ||
                  !!cursorData.auto_model_selected_display_message ||
                  !!cursorData.named_model_selected_display_message ||
                  (cursorData.connect_extras != null && Object.keys(cursorData.connect_extras).length > 0) ||
                  (cursorData.enterprise_usage != null && Object.keys(cursorData.enterprise_usage).length > 0)) && (
                  <div className="usage-section">
                    <h2 className="section-heading">Extended usage</h2>
                    <p className="extra-usage-details" style={{ marginBottom: 8, opacity: 0.85, fontSize: 11 }}>
                      Extra fields from Cursor&apos;s Connect RPCs and <code>cursor.com</code> when available.
                      Many Enterprise meters only expose spend vs limit above; model split and on-demand may be absent.
                    </p>
                    {cursorData.billing_cycle_start && (
                      <div className="extra-usage-details">
                        <span>
                          Cycle starts{" "}
                          {new Date(cursorData.billing_cycle_start).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                    {cursorData.plan_remaining_cents != null && (
                      <div className="extra-usage-details">
                        <span>Included remaining (Connect)</span>
                        <span>{formatCurrencyFromCents(cursorData.plan_remaining_cents)}</span>
                      </div>
                    )}
                    {cursorData.usage_meter_enabled != null && (
                      <div className="extra-usage-details">
                        <span>Dashboard meter enabled</span>
                        <span>{cursorData.usage_meter_enabled ? "yes" : "no"}</span>
                      </div>
                    )}
                    {cursorData.display_threshold_bp != null && (
                      <div className="extra-usage-details">
                        <span>Display threshold (basis points)</span>
                        <span>{cursorData.display_threshold_bp}</span>
                      </div>
                    )}
                    {cursorData.auto_model_selected_display_message && (
                      <div className="extra-usage-details">
                        <span title="From Cursor Connect">Auto mode message</span>
                        <span>{cursorData.auto_model_selected_display_message}</span>
                      </div>
                    )}
                    {cursorData.named_model_selected_display_message && (
                      <div className="extra-usage-details">
                        <span title="From Cursor Connect">Named model message</span>
                        <span>{cursorData.named_model_selected_display_message}</span>
                      </div>
                    )}
                    {cursorData.connect_extras != null && Object.keys(cursorData.connect_extras).length > 0 && (
                      <CursorConnectExtrasFriendly data={cursorData.connect_extras} />
                    )}
                    {cursorData.enterprise_usage != null && Object.keys(cursorData.enterprise_usage).length > 0 && (
                      <CursorEnterpriseUsageFriendly data={cursorData.enterprise_usage} />
                    )}
                  </div>
                )}
              </>
            ) : cursorError ? (
              <div className="loading-state">
                <p style={{ fontSize: '12px' }}>{cursorError}</p>
              </div>
            ) : (
              <div className="loading-state">
                <p>Waiting for data...</p>
              </div>
            )}
          </div>

          {cursorLastUpdated && (
            <div className="popover-footer">
              Last updated: {formatTimestamp(cursorLastUpdated)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
