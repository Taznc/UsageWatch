import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AddReport,
  HostTarget,
  McpHost,
  McpHostConfig,
  McpServerEntry,
  RestartPromptPayload,
  UnifiedServerView,
} from "../types/mcp";

export interface UseMcpManager {
  hosts: McpHostConfig[];
  unified: UnifiedServerView[];
  running: McpHost[];
  projects: string[];
  loading: boolean;
  error: string | null;
  restartPrompt: RestartPromptPayload | null;
  refresh: () => Promise<void>;
  setEnabled: (server: string, target: HostTarget, enabled: boolean) => Promise<void>;
  setEnabledBulk: (server: string, changes: [HostTarget, boolean][]) => Promise<void>;
  addServer: (server: McpServerEntry, targets: HostTarget[], enabled: boolean) => Promise<AddReport>;
  removeServer: (server: string, target: HostTarget) => Promise<void>;
  copyServer: (server: string, from: HostTarget, to: HostTarget[], enabled: boolean) => Promise<AddReport>;
  registerProject: (path: string) => Promise<void>;
  unregisterProject: (path: string) => Promise<void>;
  restartHost: (host: McpHost) => Promise<void>;
  restartServer: (host: McpHost, server: string) => Promise<void>;
  dismissRestartPrompt: () => void;
}

export function useMcpManager(): UseMcpManager {
  const [hosts, setHosts] = useState<McpHostConfig[]>([]);
  const [unified, setUnified] = useState<UnifiedServerView[]>([]);
  const [running, setRunning] = useState<McpHost[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Single state avoids nested setState (dismiss/enqueue bugs when batched). */
  const [restartPromptState, setRestartPromptState] = useState<{
    current: RestartPromptPayload | null;
    queue: RestartPromptPayload[];
  }>({ current: null, queue: [] });

  const restartPrompt = restartPromptState.current;

  const enqueueRestartPrompt = useCallback((payload: RestartPromptPayload) => {
    setRestartPromptState((s) => {
      if (!s.current) return { ...s, current: payload };
      return { ...s, queue: [...s.queue, payload] };
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, u, r, p] = await Promise.all([
        invoke<McpHostConfig[]>("mcp_list_hosts"),
        invoke<UnifiedServerView[]>("mcp_list_servers_unified"),
        invoke<McpHost[]>("mcp_running_hosts"),
        invoke<string[]>("mcp_list_projects"),
      ]);
      setHosts(h);
      setUnified(u);
      setRunning(r);
      setProjects(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const un = listen<RestartPromptPayload>("mcp-restart-prompt", (ev) => {
      enqueueRestartPrompt(ev.payload);
    });
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }, [enqueueRestartPrompt]);

  const setEnabled = useCallback(
    async (server: string, target: HostTarget, enabled: boolean) => {
      await invoke("mcp_set_enabled", { server, target, enabled });
      enqueueRestartPrompt({ hosts: [target.host], server });
      await refresh();
    },
    [enqueueRestartPrompt, refresh],
  );

  const setEnabledBulk = useCallback(
    async (server: string, changes: [HostTarget, boolean][]) => {
      await invoke("mcp_set_enabled_bulk", { server, changes });
      const hosts = Array.from(
        new Set(changes.map(([target]) => target.host)),
      );
      if (hosts.length > 0) {
        enqueueRestartPrompt({ hosts, server });
      }
      await refresh();
    },
    [enqueueRestartPrompt, refresh],
  );

  const addServer = useCallback(
    async (server: McpServerEntry, targets: HostTarget[], enabled: boolean) => {
      const report = await invoke<AddReport>("mcp_add_server", {
        input: { server, targets, enabled },
      });
      await refresh();
      return report;
    },
    [refresh],
  );

  const removeServer = useCallback(
    async (server: string, target: HostTarget) => {
      await invoke("mcp_remove_server", { server, target });
      await refresh();
    },
    [refresh],
  );

  const copyServer = useCallback(
    async (server: string, from: HostTarget, to: HostTarget[], enabled: boolean) => {
      const report = await invoke<AddReport>("mcp_copy_server", {
        input: { server, from, to, enabled },
      });
      await refresh();
      return report;
    },
    [refresh],
  );

  const registerProject = useCallback(
    async (path: string) => {
      await invoke("mcp_register_project", { path });
      await refresh();
    },
    [refresh],
  );

  const unregisterProject = useCallback(
    async (path: string) => {
      await invoke("mcp_unregister_project", { path });
      await refresh();
    },
    [refresh],
  );

  const restartHost = useCallback(
    async (host: McpHost) => {
      await invoke("mcp_restart_host", { host });
      // Brief pause then refresh running list
      setTimeout(() => {
        invoke<McpHost[]>("mcp_running_hosts").then(setRunning).catch(() => {});
      }, 1500);
    },
    [],
  );

  const restartServer = useCallback(
    async (host: McpHost, server: string) => {
      await invoke("mcp_restart_server", { host, server });
      setTimeout(() => {
        invoke<McpHost[]>("mcp_running_hosts").then(setRunning).catch(() => {});
      }, 750);
    },
    [],
  );

  const dismissRestartPrompt = useCallback(() => {
    setRestartPromptState((s) => ({
      current: s.queue[0] ?? null,
      queue: s.queue.slice(1),
    }));
  }, []);

  return {
    hosts,
    unified,
    running,
    projects,
    loading,
    error,
    restartPrompt,
    refresh,
    setEnabled,
    setEnabledBulk,
    addServer,
    removeServer,
    copyServer,
    registerProject,
    unregisterProject,
    restartHost,
    restartServer,
    dismissRestartPrompt,
  };
}
