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

  // Past or same instant: works after "Resets " in widgets ("Resets on …")
  if (diff <= 0 || !Number.isFinite(reset)) {
    const when = new Date(resetAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `on ${when}`;
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return minutes > 0 ? `${hours} hours ${minutes} min` : `${hours} hours`;
  }
  if (minutes > 0) {
    return `${minutes} min`;
  }
  return `${seconds}s`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatResetDate(resetAt: string | null): string {
  if (!resetAt) return "";
  const date = new Date(resetAt);
  const now = new Date();

  // If within the next 24 hours, just show time
  const diffMs = date.getTime() - now.getTime();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // Otherwise show day + time like "Tue 1:00 PM"
  return date.toLocaleDateString([], { weekday: "short" }) + " " +
    date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatPollInterval(secs: number): string {
  if (secs >= 60) {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return remainder > 0 ? `${mins}m ${remainder}s` : `${mins}m`;
  }
  return `${secs}s`;
}
