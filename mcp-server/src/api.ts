import type { UsageUpdate, CodexUpdate, CursorUpdate } from "./types.js";

const BASE = "http://127.0.0.1:52700";

export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" }
  | { status: "app_not_running" }
  | { status: "http_error"; code: number };

async function fetchEndpoint<T>(path: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.status === 503) return { status: "unavailable" };
    if (!res.ok) return { status: "http_error", code: res.status };
    return { status: "ok", data: (await res.json()) as T };
  } catch (e: unknown) {
    if (e instanceof TypeError && (e as NodeJS.ErrnoException).cause) {
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === "ECONNREFUSED") return { status: "app_not_running" };
    }
    return { status: "app_not_running" };
  }
}

export function fetchClaude(): Promise<FetchResult<UsageUpdate>> {
  return fetchEndpoint<UsageUpdate>("/api/usage");
}

export function fetchCodex(): Promise<FetchResult<CodexUpdate>> {
  return fetchEndpoint<CodexUpdate>("/api/codex");
}

export function fetchCursor(): Promise<FetchResult<CursorUpdate>> {
  return fetchEndpoint<CursorUpdate>("/api/cursor");
}
