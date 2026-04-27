import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AddReport,
  HostTarget,
  McpHostConfig,
  McpServerEntry,
  SupportLevel,
  Transport,
} from "../../types/mcp";
import { targetKey, targetLabel } from "../../types/mcp";

interface Props {
  hosts: McpHostConfig[];
  /** When provided, the editor pre-fills from this server (edit mode). */
  initial?: { entry: McpServerEntry; presentTargets: HostTarget[] } | null;
  /** When provided, the editor opens with this single target pre-selected. */
  preselect?: HostTarget | null;
  onCancel: () => void;
  onSave: (
    entry: McpServerEntry,
    targets: HostTarget[],
    enabled: boolean,
  ) => Promise<AddReport>;
}

interface TargetSupport {
  target: HostTarget;
  support: SupportLevel;
  note?: string;
}

export function McpServerEditor({
  hosts,
  initial,
  preselect,
  onCancel,
  onSave,
}: Props) {
  const [name, setName] = useState(initial?.entry.name ?? "");
  const [transport, setTransport] = useState<Transport>(
    initial?.entry.transport ?? "stdio",
  );
  const [command, setCommand] = useState(initial?.entry.command ?? "");
  const [argsText, setArgsText] = useState(
    (initial?.entry.args ?? []).join("\n"),
  );
  const [envText, setEnvText] = useState(
    Object.entries(initial?.entry.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [url, setUrl] = useState(initial?.entry.url ?? "");
  const [headersText, setHeadersText] = useState(
    Object.entries(initial?.entry.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  );
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (initial) initial.presentTargets.forEach((t) => s.add(targetKey(t)));
    if (preselect) s.add(targetKey(preselect));
    return s;
  });
  const [supports, setSupports] = useState<TargetSupport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildEntry = useMemo<() => McpServerEntry>(() => {
    return () => {
      const args = argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const env: Record<string, string> = {};
      envText.split("\n").forEach((line) => {
        const t = line.trim();
        if (!t) return;
        const eq = t.indexOf("=");
        if (eq <= 0) return;
        env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      });
      const headers: Record<string, string> = {};
      headersText.split("\n").forEach((line) => {
        const t = line.trim();
        if (!t) return;
        const c = t.indexOf(":");
        if (c <= 0) return;
        headers[t.slice(0, c).trim()] = t.slice(c + 1).trim();
      });
      return {
        name: name.trim(),
        transport,
        command: transport === "stdio" ? command.trim() || undefined : undefined,
        args: transport === "stdio" && args.length ? args : undefined,
        env: transport === "stdio" && Object.keys(env).length ? env : undefined,
        url: transport !== "stdio" ? url.trim() || undefined : undefined,
        headers:
          transport !== "stdio" && Object.keys(headers).length ? headers : undefined,
        raw: initial?.entry.raw ?? {},
      };
    };
  }, [argsText, command, envText, headersText, initial, name, transport, url]);

  // Compute per-host support level for the user's current entry shape.
  useEffect(() => {
    let cancelled = false;
    const entry = buildEntry();
    const targets = hosts.filter((h) => !h.error);
    Promise.all(
      targets.map(async (h) => {
        const target: HostTarget = { host: h.host, scope: h.scope };
        try {
          const r = await invoke<{ support: SupportLevel }>(
            "mcp_preview_translation",
            { host: h.host, server: entry },
          );
          return { target, support: r.support };
        } catch {
          return { target, support: "native" as SupportLevel };
        }
      }),
    ).then((results) => {
      if (!cancelled) setSupports(results);
    });
    return () => {
      cancelled = true;
    };
  }, [buildEntry, hosts]);

  const toggleTarget = (t: HostTarget) => {
    const k = targetKey(t);
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(k)) ns.delete(k);
      else ns.add(k);
      return ns;
    });
  };

  const onSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const targets = supports
      .filter((s) => selected.has(targetKey(s.target)))
      .filter((s) => s.support !== "unsupported")
      .map((s) => s.target);
    if (targets.length === 0) {
      setError("Select at least one supported host.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const report = await onSave(buildEntry(), targets, enabled);
      const failures = report.outcomes.filter((o) => !o.written);
      if (failures.length) {
        setError(
          failures
            .map((f) => `${f.target.host}: ${f.note ?? "skipped"}`)
            .join("; "),
        );
        setBusy(false);
        return;
      }
      onCancel();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mcp-modal-backdrop" onClick={onCancel}>
      <div className="mcp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit MCP server" : "Add MCP server"}</h3>

        <label>Name</label>
        <input
          type="text"
          value={name}
          disabled={!!initial}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
        />

        <label>Transport</label>
        <select
          value={transport}
          onChange={(e) => setTransport(e.target.value as Transport)}
        >
          <option value="stdio">stdio (command + args)</option>
          <option value="sse">SSE (URL)</option>
          <option value="http">HTTP (URL)</option>
        </select>

        {transport === "stdio" && (
          <>
            <label>Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="node"
            />
            <label>Args (one per line)</label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={"path/to/server.js\n--port=3000"}
            />
            <label>Env (KEY=value, one per line)</label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="API_KEY=..."
            />
          </>
        )}

        {transport !== "stdio" && (
          <>
            <label>URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
            <label>Headers (Key: value, one per line)</label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder="Authorization: Bearer ..."
            />
          </>
        )}

        <label>Apply to</label>
        <div>
          {supports.map((s) => {
            const k = targetKey(s.target);
            const blocked = s.support === "unsupported";
            const isOn = selected.has(k);
            return (
              <div className="mcp-target-row" key={k}>
                <input
                  type="checkbox"
                  checked={isOn && !blocked}
                  disabled={blocked}
                  onChange={() => toggleTarget(s.target)}
                />
                <span>{targetLabel(s.target)}</span>
                {s.support === "translated" && (
                  <span className="warn">translated to host format</span>
                )}
                {blocked && (
                  <span className="warn blocked">
                    transport not supported by this host
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <input
            id="mcp-add-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <label
            htmlFor="mcp-add-enabled"
            style={{ margin: 0, opacity: 1, fontSize: 12 }}
          >
            Enable immediately (otherwise added in disabled state)
          </label>
        </div>

        {error && <div className="mcp-error" style={{ marginTop: 10 }}>{error}</div>}

        <div className="mcp-actions">
          <button className="mcp-btn subtle" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="mcp-btn" onClick={onSubmit} disabled={busy}>
            {busy ? "Saving…" : initial ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
