import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getUsageHistory, HistoryPoint } from "../hooks/useHistoryRecorder";

interface ChartDataPoint {
  time: string;
  session: number | null;
  weekly: number | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Downsample to ~100 points max to keep chart readable
function downsample(points: HistoryPoint[], maxPoints: number = 100): HistoryPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0);
}

export function HistoryChart() {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const history = await getUsageHistory(7);
        const sampled = downsample(history);
        setData(
          sampled.map((p) => ({
            time: formatTime(p.timestamp),
            session: p.five_hour_pct,
            weekly: p.seven_day_pct,
          }))
        );
      } catch (e) {
        console.error("Failed to load history:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="chart-loading">Loading history...</div>;
  }

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        No history data yet. Data will appear after a few polling cycles.
      </div>
    );
  }

  return (
    <div className="history-chart">
      <h3 className="chart-title">7-Day Usage History</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#8892a4" }}
            interval="preserveStartEnd"
            tickCount={5}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "#8892a4" }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#1e2a45",
              border: "1px solid #2a3a5c",
              borderRadius: 6,
              fontSize: 12,
              color: "#e0e0e0",
            }}
            formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#8892a4" }}
          />
          <Line
            type="monotone"
            dataKey="session"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name="Session (5h)"
          />
          <Line
            type="monotone"
            dataKey="weekly"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
            name="Weekly (7d)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
