import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useWidget } from "../context/WidgetContext";
import { isTauriRuntime } from "../widget/preview";
import type {
  UsageUpdate,
  CodexUpdate,
  CursorUpdate,
  BillingInfo,
  Provider,
} from "../types/usage";

export function useWidgetData() {
  const { dispatch } = useWidget();
  const tauri = isTauriRuntime();

  // Listen for usage broadcasts — same events the main window receives
  useEffect(() => {
    if (!tauri) return;
    const unlisten = listen<UsageUpdate>("usage-update", (event) => {
      if (event.payload.data) {
        dispatch({ type: "SET_USAGE", data: event.payload.data });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch, tauri]);

  useEffect(() => {
    if (!tauri) return;
    const unlisten = listen<CodexUpdate>("codex-update", (event) => {
      if (event.payload.data) {
        dispatch({ type: "SET_CODEX", data: event.payload.data });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch, tauri]);

  useEffect(() => {
    if (!tauri) return;
    const unlisten = listen<CursorUpdate>("cursor-update", (event) => {
      if (event.payload.data) {
        dispatch({ type: "SET_CURSOR", data: event.payload.data });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch, tauri]);

  useEffect(() => {
    if (!tauri) return;
    const unlisten = listen<Provider>("provider-changed", (event) => {
      dispatch({ type: "SET_ACTIVE_PROVIDER", provider: event.payload });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch, tauri]);

  // Prime from backend snapshots, then refresh supplemental non-polled data.
  useEffect(() => {
    if (!tauri) return;
    async function primeFromCache() {
      try {
        const provider = await invoke<Provider>("get_active_provider");
        dispatch({ type: "SET_ACTIVE_PROVIDER", provider });
      } catch {
        // Non-critical
      }

      try {
        const usageUpdate = await invoke<UsageUpdate | null>("get_latest_usage_update");
        if (usageUpdate?.data) {
          dispatch({ type: "SET_USAGE", data: usageUpdate.data });
        }
      } catch {
        // Non-critical
      }

      try {
        const codexUpdate = await invoke<CodexUpdate | null>("get_latest_codex_update");
        if (codexUpdate?.data) {
          dispatch({ type: "SET_CODEX", data: codexUpdate.data });
        }
      } catch {
        // Non-critical
      }

      try {
        const cursorUpdate = await invoke<CursorUpdate | null>("get_latest_cursor_update");
        if (cursorUpdate?.data) {
          dispatch({ type: "SET_CURSOR", data: cursorUpdate.data });
        }
      } catch {
        // Non-critical
      }
    }

    async function fetchSupplemental() {
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
    }

    primeFromCache();
    fetchSupplemental();
    const interval = setInterval(fetchSupplemental, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dispatch, tauri]);
}
