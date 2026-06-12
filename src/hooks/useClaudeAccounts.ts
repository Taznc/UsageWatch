import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeAccountView, RescanRow } from "../types/accounts";

/// Shared state for detected Claude accounts. Used by the Settings accounts panel
/// and the Popover quick switcher. Re-fetches whenever an account is switched/added.
export function useClaudeAccounts() {
  const [accounts, setAccounts] = useState<ClaudeAccountView[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<ClaudeAccountView[]>("list_claude_accounts");
      setAccounts(list);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    reload();
    const unlisten = listen("claude-account-changed", () => reload());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [reload]);

  const switchTo = useCallback(async (id: string) => {
    await invoke("set_active_claude_account", { id });
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await invoke("remove_claude_account", { id });
    await reload();
  }, [reload]);

  const rescan = useCallback(async (): Promise<RescanRow[]> => {
    setLoading(true);
    try {
      const rows = await invoke<RescanRow[]>("rescan_claude_accounts");
      await reload();
      return rows;
    } finally {
      setLoading(false);
    }
  }, [reload]);

  const activeId = accounts.find((a) => a.is_active)?.id ?? null;

  return { accounts, activeId, loading, reload, switchTo, remove, rescan };
}
