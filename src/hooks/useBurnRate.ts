import { useState, useEffect } from "react";
import { getBurnRate, BurnRate } from "./useHistoryRecorder";

export function useBurnRate(
  sessionPct: number | null,
  weeklyPct: number | null
): BurnRate {
  const [burnRate, setBurnRate] = useState<BurnRate>({
    session_pct_per_hour: null,
    session_mins_to_limit: null,
    weekly_pct_per_hour: null,
    weekly_mins_to_limit: null,
  });

  useEffect(() => {
    getBurnRate(sessionPct, weeklyPct).then(setBurnRate).catch(() => {});
  }, [sessionPct, weeklyPct]);

  return burnRate;
}
