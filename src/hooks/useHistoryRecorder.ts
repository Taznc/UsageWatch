import { useEffect, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { UsageData } from "../types/usage";

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:usage_history.db");
  }
  return db;
}

export function useHistoryRecorder(usageData: UsageData | null) {
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!usageData) return;

    const now = new Date().toISOString();
    // Don't record more than once per 25 seconds to avoid duplicates
    if (lastRecorded.current) {
      const diff = Date.now() - new Date(lastRecorded.current).getTime();
      if (diff < 25000) return;
    }

    async function record() {
      try {
        const database = await getDb();
        await database.execute(
          `INSERT INTO usage_history (timestamp, five_hour_pct, five_hour_reset_at, seven_day_pct, seven_day_reset_at, seven_day_opus_pct, extra_spending, extra_budget)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            now,
            usageData!.five_hour?.utilization ?? null,
            usageData!.five_hour?.resets_at ?? null,
            usageData!.seven_day?.utilization ?? null,
            usageData!.seven_day?.resets_at ?? null,
            usageData!.seven_day_opus?.utilization ?? null,
            usageData!.extra_usage?.used_credits ?? null,
            usageData!.extra_usage?.monthly_limit ?? null,
          ]
        );
        lastRecorded.current = now;
      } catch (e) {
        console.error("Failed to record history:", e);
      }
    }

    record();
  }, [usageData]);
}

export interface HistoryPoint {
  timestamp: string;
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  seven_day_opus_pct: number | null;
}

export interface BurnRate {
  session_pct_per_hour: number | null;
  session_mins_to_limit: number | null;
  weekly_pct_per_hour: number | null;
  weekly_mins_to_limit: number | null;
}

export async function getBurnRate(
  currentSessionPct: number | null,
  currentWeeklyPct: number | null
): Promise<BurnRate> {
  const nullResult: BurnRate = {
    session_pct_per_hour: null,
    session_mins_to_limit: null,
    weekly_pct_per_hour: null,
    weekly_mins_to_limit: null,
  };

  try {
    const database = await getDb();
    const cutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const rows = await database.select<
      { timestamp: string; five_hour_pct: number | null; seven_day_pct: number | null }[]
    >(
      `SELECT timestamp, five_hour_pct, seven_day_pct
       FROM usage_history
       WHERE timestamp > $1
       ORDER BY timestamp ASC`,
      [cutoff]
    );

    if (rows.length < 2) return nullResult;

    function calcRate(
      points: { timestamp: string; pct: number }[],
      currentPct: number | null
    ): { pctPerHour: number | null; minsToLimit: number | null } {
      if (points.length < 2 || currentPct == null) {
        return { pctPerHour: null, minsToLimit: null };
      }

      if (currentPct >= 100) {
        return { pctPerHour: null, minsToLimit: 0 };
      }

      const first = points[0];
      const firstTime = new Date(first.timestamp).getTime();
      const nowTime = Date.now();
      const hoursElapsed = (nowTime - firstTime) / (1000 * 60 * 60);

      if (hoursElapsed < 0.005) {
        return { pctPerHour: null, minsToLimit: null };
      }

      const delta = currentPct - first.pct;
      // Negative delta means a reset happened — rate is not meaningful
      if (delta <= 0) {
        return { pctPerHour: null, minsToLimit: null };
      }

      const pctPerHour = delta / hoursElapsed;
      const remaining = 100 - currentPct;
      const minsToLimit = remaining / (pctPerHour / 60);

      return { pctPerHour, minsToLimit: Math.round(minsToLimit) };
    }

    const sessionPoints = rows
      .filter((r) => r.five_hour_pct != null)
      .map((r) => ({ timestamp: r.timestamp, pct: r.five_hour_pct! }));

    const weeklyPoints = rows
      .filter((r) => r.seven_day_pct != null)
      .map((r) => ({ timestamp: r.timestamp, pct: r.seven_day_pct! }));

    const session = calcRate(sessionPoints, currentSessionPct);
    const weekly = calcRate(weeklyPoints, currentWeeklyPct);

    return {
      session_pct_per_hour: session.pctPerHour,
      session_mins_to_limit: session.minsToLimit,
      weekly_pct_per_hour: weekly.pctPerHour,
      weekly_mins_to_limit: weekly.minsToLimit,
    };
  } catch (e) {
    console.error("Failed to calculate burn rate:", e);
    return nullResult;
  }
}

export async function getUsageHistory(days: number = 7): Promise<HistoryPoint[]> {
  const database = await getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await database.select<HistoryPoint[]>(
    `SELECT timestamp, five_hour_pct, seven_day_pct, seven_day_opus_pct
     FROM usage_history
     WHERE timestamp > $1
     ORDER BY timestamp ASC`,
    [cutoff]
  );
  return rows;
}
