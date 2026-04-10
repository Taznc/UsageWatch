export function getUsageColor(pct: number): string {
  if (pct >= 90) return "#ef4444"; // red
  if (pct >= 75) return "#f59e0b"; // orange
  return "#22c55e"; // green
}

export function getUsageColorClass(pct: number): string {
  if (pct >= 90) return "usage-red";
  if (pct >= 75) return "usage-orange";
  return "usage-green";
}

export function formatCountdown(resetAt: string | null): string {
  if (!resetAt) return "--";

  const now = Date.now();
  const reset = new Date(resetAt).getTime();
  const diff = reset - now;

  if (diff <= 0) return "Resetting...";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatPollInterval(secs: number): string {
  if (secs >= 60) {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return remainder > 0 ? `${mins}m ${remainder}s` : `${mins}m`;
  }
  return `${secs}s`;
}
