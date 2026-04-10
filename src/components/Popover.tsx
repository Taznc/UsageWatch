import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const [pinned, setPinned] = useState(false);

  const hideWindow = () => getCurrentWindow().hide();
  const startDrag = (e: React.MouseEvent) => {
    // Only drag from the header background, not from buttons
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging();
  };

  // Hide window when it loses focus (clicking outside) — unless pinned
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && !pinned) hideWindow();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [pinned]);

  // Record usage data to SQLite on each update
  useHistoryRecorder(usageData);

  return (
    <div className="popover">
      <div className="popover-header" onMouseDown={startDrag}>
        <h1 className="popover-title">Claude Usage</h1>
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
                  label="Current Session"
                  percentage={usageData.five_hour.utilization}
                  resetAt={usageData.five_hour.resets_at}
                  showRemaining={show_remaining}
                />
              )}

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

              {usageData.extra_usage &&
                usageData.extra_usage.is_enabled && (
                  <div className="extra-usage">
                    <div className="usage-bar-header">
                      <span className="usage-bar-label">Extra Usage</span>
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
                      <span>${(usageData.extra_usage.monthly_limit / 100).toFixed(2)} limit</span>
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
