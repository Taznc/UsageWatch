import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUsageData } from "../hooks/useUsageData";
import { useHistoryRecorder } from "../hooks/useHistoryRecorder";
import { useApp } from "../context/AppContext";
import { UsageBar } from "./UsageBar";
import { HistoryChart } from "./HistoryChart";
import { StatusIndicator } from "./StatusIndicator";
import { formatTimestamp } from "../utils/format";
import type { BillingInfo } from "../types/usage";

export function Popover() {
  const { usageData, lastUpdated, error, isLoading, isOffline, refresh } = useUsageData();
  const { state, dispatch } = useApp();
  const { show_remaining } = state.settings;
  const { codexData, codexError, codexLastUpdated } = state;
  const [activeTab, setActiveTab] = useState<'claude' | 'codex'>('claude');
  const [showHistory, setShowHistory] = useState(false);
  const hasCodex = !!(codexData || codexError);
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

      {/* Tab bar — only rendered when Codex data is available */}
      {hasCodex && (
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'claude' ? 'active' : ''}`}
            onClick={() => setActiveTab('claude')}
          >
            Claude
          </button>
          <button
            className={`tab-btn ${activeTab === 'codex' ? 'active' : ''}`}
            onClick={() => setActiveTab('codex')}
          >
            Codex
          </button>
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

                  {usageData.extra_usage &&
                    usageData.extra_usage.is_enabled && (
                      <div className="usage-section">
                        <h2 className="section-heading">Extra Usage</h2>
                        <div className="extra-usage">
                          <div className="usage-bar-header">
                            <span className="usage-bar-pct" style={{ color: "#8b5cf6" }}>
                              {usageData.extra_usage.utilization.toFixed(0)}% used
                            </span>
                          </div>
                          <div className="usage-bar-track">
                            <div
                              className="usage-bar-fill"
                              style={{
                                width: `${Math.min(usageData.extra_usage.utilization, 100)}%`,
                                backgroundColor: "#8b5cf6",
                              }}
                            />
                          </div>
                          <div className="extra-usage-details">
                            <span>${(usageData.extra_usage.used_credits / 100).toFixed(2)} spent</span>
                            <span>${(usageData.extra_usage.monthly_limit / 100).toFixed(2)} / mo limit</span>
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
                        <span className="billing-label">Available balance</span>
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
    </div>
  );
}
