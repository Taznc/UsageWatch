import { useState } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { useHistoryRecorder } from "../hooks/useHistoryRecorder";
import { useApp } from "../context/AppContext";
import { UsageBar } from "./UsageBar";
import { HistoryChart } from "./HistoryChart";
import { StatusIndicator } from "./StatusIndicator";
import { formatTimestamp } from "../utils/format";

export function Popover() {
  const { usageData, lastUpdated, error, isLoading, isOffline, refresh } = useUsageData();
  const { state, dispatch } = useApp();
  const { show_remaining } = state.settings;
  const [showHistory, setShowHistory] = useState(false);

  // Record usage data to SQLite on each update
  useHistoryRecorder(usageData);

  return (
    <div className="popover">
      <div className="popover-header">
        <h1 className="popover-title">Claude Usage</h1>
        <div className="popover-actions">
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
        </div>
      </div>

      <StatusIndicator />

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
                <UsageBar
                  label="Session (5h)"
                  percentage={usageData.five_hour.utilization_pct}
                  resetAt={usageData.five_hour.reset_at}
                  showRemaining={show_remaining}
                />
              )}

              {usageData.seven_day && (
                <UsageBar
                  label="Weekly (7d)"
                  percentage={usageData.seven_day.utilization_pct}
                  resetAt={usageData.seven_day.reset_at}
                  showRemaining={show_remaining}
                />
              )}

              {usageData.seven_day_opus &&
                usageData.seven_day_opus.utilization_pct > 0 && (
                  <UsageBar
                    label="Opus (7d)"
                    percentage={usageData.seven_day_opus.utilization_pct}
                    resetAt={usageData.seven_day_opus.reset_at}
                    showRemaining={show_remaining}
                  />
                )}

              {usageData.extra_usage &&
                usageData.extra_usage.budget_limit > 0 && (
                  <div className="extra-usage">
                    <div className="usage-bar-header">
                      <span className="usage-bar-label">Extra Usage</span>
                      <span className="usage-bar-pct">
                        ${usageData.extra_usage.current_spending.toFixed(2)} / $
                        {usageData.extra_usage.budget_limit.toFixed(2)}
                      </span>
                    </div>
                    <div className="usage-bar-track">
                      <div
                        className="usage-bar-fill"
                        style={{
                          width: `${Math.min(
                            (usageData.extra_usage.current_spending /
                              usageData.extra_usage.budget_limit) *
                              100,
                            100
                          )}%`,
                          backgroundColor: "#8b5cf6",
                        }}
                      />
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
    </div>
  );
}
