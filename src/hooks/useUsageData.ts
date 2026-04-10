import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../context/AppContext";
import type { UsageUpdate } from "../types/usage";

export function useUsageData() {
  const { state, dispatch } = useApp();

  // Listen for polling updates from Rust backend
  useEffect(() => {
    const unlisten = listen<UsageUpdate>("usage-update", (event) => {
      const update = event.payload;
      if (update.data) {
        dispatch({ type: "SET_USAGE", data: update.data, timestamp: update.timestamp });
      } else if (update.error) {
        dispatch({ type: "SET_ERROR", error: update.error, timestamp: update.timestamp });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [dispatch]);

  // Listen for refresh requests from tray menu
  useEffect(() => {
    const unlisten = listen("refresh-requested", () => {
      refresh();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for settings open requests from tray menu
  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      dispatch({ type: "SET_VIEW", view: "settings" });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [dispatch]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => dispatch({ type: "SET_OFFLINE", offline: false });
    const handleOffline = () => dispatch({ type: "SET_OFFLINE", offline: true });

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    dispatch({ type: "SET_OFFLINE", offline: !navigator.onLine });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [dispatch]);

  const refresh = useCallback(async () => {
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const sessionKey = await invoke<string | null>("get_session_key");
      const orgId = await invoke<string | null>("get_org_id");
      if (!sessionKey || !orgId) {
        dispatch({ type: "SET_ERROR", error: "No credentials configured", timestamp: new Date().toISOString() });
        return;
      }
      const data = await invoke("fetch_usage", { sessionKey, orgId });
      dispatch({ type: "SET_USAGE", data: data as any, timestamp: new Date().toISOString() });
    } catch (e: any) {
      dispatch({ type: "SET_ERROR", error: String(e), timestamp: new Date().toISOString() });
    }
  }, [dispatch]);

  return {
    usageData: state.usageData,
    lastUpdated: state.lastUpdated,
    error: state.error,
    isLoading: state.isLoading,
    isOffline: state.isOffline,
    refresh,
  };
}
