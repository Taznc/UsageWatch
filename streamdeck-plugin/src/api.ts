const BASE_URL = "http://127.0.0.1:52700";

export interface UsageWindow {
  utilization: number;
  resets_at?: string;
}

export interface UsageData {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
}

export interface UsageUpdate {
  data?: UsageData;
  error?: string;
  timestamp: string;
}

export async function fetchUsage(): Promise<UsageUpdate | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/usage`);
    if (!response.ok) return null;
    return (await response.json()) as UsageUpdate;
  } catch {
    return null;
  }
}

export async function openWindow(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/open`, { method: "POST" });
  } catch {
    // UsageWatch not running — silently ignore
  }
}
