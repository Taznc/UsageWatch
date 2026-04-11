import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useWidget } from "../context/WidgetContext";
import type { UsageUpdate, CodexUpdate, BillingInfo, UsageData } from "../types/usage";
import type { APIStatusResponse } from "../types/widget";

export function useWidgetData() {
  const { dispatch } = useWidget();

  // Listen for usage broadcasts — same events the main window receives
  useEffect(() => {
    const unlisten = listen<UsageUpdate>("usage-update", (event) => {
      if (event.payload.data) {
        dispatch({ type: "SET_USAGE", data: event.payload.data });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch]);

  useEffect(() => {
    const unlisten = listen<CodexUpdate>("codex-update", (event) => {
      if (event.payload.data) {
        dispatch({ type: "SET_CODEX", data: event.payload.data });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch]);

  // On mount: immediately fetch current data (don't wait up to 60s for next poll event)
  // Also refresh billing + status every 5 minutes
  useEffect(() => {
    async function fetchAll() {
      try {
        const sessionKey = await invoke<string | null>("get_session_key");
        const orgId = await invoke<string | null>("get_org_id");
        if (sessionKey && orgId) {
          // Fetch usage immediately so tiles aren't stuck at 0%
          const usageData = await invoke<UsageData>("fetch_usage", { sessionKey, orgId });
          dispatch({ type: "SET_USAGE", data: usageData });

          const billing = await invoke<BillingInfo>("fetch_billing", { sessionKey, orgId });
          dispatch({ type: "SET_BILLING", data: billing });
        }
      } catch {
        // Non-critical — widget shows what it can
      }

      try {
        // fetch_status returns { status: { indicator, description }, page: {...} }
        const raw = await invoke<APIStatusResponse>("fetch_status");
        if (raw?.status) {
          dispatch({ type: "SET_STATUS", data: raw.status });
        }
      } catch {
        // Non-critical
      }
    }

    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dispatch]);
}
