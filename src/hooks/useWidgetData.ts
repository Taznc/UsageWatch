import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useWidget } from "../context/WidgetContext";
import type { UsageUpdate, CodexUpdate, BillingInfo } from "../types/usage";
import type { APIStatus } from "../types/widget";

export function useWidgetData() {
  const { dispatch } = useWidget();

  // Listen for usage broadcasts (same events the main window receives)
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

  // Fetch billing + status once on mount and every 5 minutes
  useEffect(() => {
    async function fetchExtras() {
      try {
        const sessionKey = await invoke<string | null>("get_session_key");
        const orgId = await invoke<string | null>("get_org_id");
        if (sessionKey && orgId) {
          const billing = await invoke<BillingInfo>("fetch_billing", { sessionKey, orgId });
          dispatch({ type: "SET_BILLING", data: billing });
        }
      } catch {
        // Non-critical — widget shows what it can
      }
      try {
        const status = await invoke<APIStatus>("fetch_status");
        dispatch({ type: "SET_STATUS", data: status });
      } catch {
        // Non-critical
      }
    }

    fetchExtras();
    const interval = setInterval(fetchExtras, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dispatch]);
}
