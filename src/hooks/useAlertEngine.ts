import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { UsageData, AlertConfig } from "../types/usage";
import type { BurnRate } from "./useHistoryRecorder";

async function notify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    const perm = await requestPermission();
    granted = perm === "granted";
  }
  if (granted) {
    sendNotification({ title, body });
  }
}

interface CooldownState {
  sessionAlertFired: boolean;
  weeklyAlertFired: boolean;
  burnRateAlertFired: boolean;
  lastSessionPct: number | null;
  lastWeeklyPct: number | null;
}

export function useAlertEngine(
  usageData: UsageData | null,
  burnRate: BurnRate
): void {
  const cooldown = useRef<CooldownState>({
    sessionAlertFired: false,
    weeklyAlertFired: false,
    burnRateAlertFired: false,
    lastSessionPct: null,
    lastWeeklyPct: null,
  });

  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!usageData) return;

    // Skip the very first render to avoid spurious notifications on app launch
    if (isFirstRun.current) {
      isFirstRun.current = false;
      // Still record initial values for reset detection
      const sessionPct = usageData.five_hour
        ? Math.round(usageData.five_hour.utilization * 100)
        : null;
      const weeklyPct = usageData.seven_day
        ? Math.round(usageData.seven_day.utilization * 100)
        : null;
      cooldown.current.lastSessionPct = sessionPct;
      cooldown.current.lastWeeklyPct = weeklyPct;
      return;
    }

    async function evaluate() {
      let config: AlertConfig;
      try {
        config = await invoke<AlertConfig>("get_alert_config");
      } catch {
        return;
      }

      if (!config.enabled) return;

      const cd = cooldown.current;

      const sessionPct = usageData!.five_hour
        ? Math.round(usageData!.five_hour.utilization * 100)
        : null;
      const weeklyPct = usageData!.seven_day
        ? Math.round(usageData!.seven_day.utilization * 100)
        : null;

      // ── Reset detection ──────────────────────────────────────────────
      if (
        cd.lastSessionPct !== null &&
        cd.lastSessionPct >= 70 &&
        sessionPct !== null &&
        sessionPct < 10
      ) {
        if (config.notify_on_reset) {
          await notify(
            "Session Reset",
            `Your session window has reset. Previous usage was ${cd.lastSessionPct}%.`
          );
        }
        cd.sessionAlertFired = false;
        cd.burnRateAlertFired = false;
      }

      if (
        cd.lastWeeklyPct !== null &&
        cd.lastWeeklyPct >= 70 &&
        weeklyPct !== null &&
        weeklyPct < 10
      ) {
        if (config.notify_on_reset) {
          await notify(
            "Weekly Reset",
            `Your weekly window has reset. Previous usage was ${cd.lastWeeklyPct}%.`
          );
        }
        cd.weeklyAlertFired = false;
      }

      // ── Session threshold check ──────────────────────────────────────
      if (config.session_threshold > 0 && sessionPct !== null) {
        if (sessionPct >= config.session_threshold && !cd.sessionAlertFired) {
          await notify(
            "Session Usage Alert",
            `Session usage at ${sessionPct}% — threshold ${config.session_threshold}%`
          );
          cd.sessionAlertFired = true;
        } else if (sessionPct < config.session_threshold) {
          cd.sessionAlertFired = false;
        }
      }

      // ── Weekly threshold check ───────────────────────────────────────
      if (config.weekly_threshold > 0 && weeklyPct !== null) {
        if (weeklyPct >= config.weekly_threshold && !cd.weeklyAlertFired) {
          await notify(
            "Weekly Usage Alert",
            `Weekly usage at ${weeklyPct}% — threshold ${config.weekly_threshold}%`
          );
          cd.weeklyAlertFired = true;
        } else if (weeklyPct < config.weekly_threshold) {
          cd.weeklyAlertFired = false;
        }
      }

      // ── Burn rate check ──────────────────────────────────────────────
      if (config.burn_rate_mins > 0 && burnRate.session_mins_to_limit !== null) {
        if (
          burnRate.session_mins_to_limit < config.burn_rate_mins &&
          !cd.burnRateAlertFired
        ) {
          await notify(
            "Burn Rate Warning",
            `At current pace, session limit in ~${burnRate.session_mins_to_limit}m`
          );
          cd.burnRateAlertFired = true;
        } else if (
          burnRate.session_mins_to_limit > config.burn_rate_mins * 1.5
        ) {
          cd.burnRateAlertFired = false;
        }
      }

      // ── Update last-known values ─────────────────────────────────────
      cd.lastSessionPct = sessionPct;
      cd.lastWeeklyPct = weeklyPct;
    }

    evaluate();
  }, [usageData, burnRate]);
}
