import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useClaudeAccounts } from "../../hooks/useClaudeAccounts";
import type { RescanRow } from "../../types/accounts";

/// Lists detected Claude accounts with switch/remove, and a "Scan for accounts"
/// action that surfaces locked/expired instances and multi-org prompts.
export function ClaudeAccountsPanel() {
  const { accounts, switchTo, remove, rescan, loading } = useClaudeAccounts();
  const [rows, setRows] = useState<RescanRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function handleScan() {
    try {
      const result = await rescan();
      // Keep only rows that need user attention (errors or org choices); resolved
      // accounts already appear in the list above.
      setRows(result.filter((r) => r.error || (r.orgs && r.orgs.length > 1)));
    } catch (e) {
      setRows([{ instance: "Scan", account: null, error: String(e), orgs: null, pending_session_key: null }]);
    }
  }

  async function completeOrg(row: RescanRow, orgId: string) {
    const org = row.orgs?.find((o) => o.uuid === orgId);
    if (!org || !row.pending_session_key) return;
    setBusy(row.instance);
    try {
      await invoke("add_claude_account", {
        label: row.instance,
        sessionKey: row.pending_session_key,
        orgId: org.uuid,
        orgName: org.name,
        email: null,
        source: "claude_instance",
        setActive: false,
      });
      setRows((rs) => rs.filter((r) => r.instance !== row.instance));
    } finally {
      setBusy(null);
    }
  }

  // Only show the panel header context when there's something to show.
  const showList = accounts.length > 0;

  return (
    <div className="account-card">
      <div className="account-card-header">
        <div className="account-card-title">
          <span className="account-provider-name">Claude accounts</span>
          {accounts.length > 1 && (
            <span className="account-status-badge connected">{accounts.length} detected</span>
          )}
        </div>
        <p className="account-org-name" style={{ fontSize: 11, opacity: 0.65 }}>
          Detected from Claude Desktop instances. The active account drives the tray and popover.
        </p>
      </div>

      {showList && (
        <div className="scan-results">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`scan-source-btn ${a.is_active ? "selected" : ""}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "default" }}
            >
              <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                <span>{a.email ?? a.label}{a.is_active && <span className="scan-source-recommended">active</span>}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>
                  {a.org_name || "—"}{a.last_verified ? ` · verified ${a.last_verified.slice(0, 10)}` : ""}
                </span>
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                {!a.is_active && (
                  <button className="account-text-btn" onClick={() => switchTo(a.id)}>
                    Switch
                  </button>
                )}
                <button className="account-text-btn" onClick={() => remove(a.id)}>
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn primary"
        style={{ marginTop: 8, width: "100%" }}
        onClick={handleScan}
        disabled={loading}
      >
        {loading ? "Scanning..." : "Scan for accounts"}
      </button>

      {rows.length > 0 && (
        <div className="scan-results" style={{ marginTop: 8 }}>
          {rows.map((row) => (
            <div key={row.instance} className="scan-source-btn" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
              <span style={{ fontWeight: 600 }}>{row.instance}</span>
              {row.error && (
                <span style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{row.error}</span>
              )}
              {row.orgs && row.orgs.length > 1 && (
                <select
                  className="input"
                  style={{ marginTop: 6 }}
                  defaultValue=""
                  disabled={busy === row.instance}
                  onChange={(e) => completeOrg(row, e.target.value)}
                >
                  <option value="">Select organization…</option>
                  {row.orgs.map((o) => (
                    <option key={o.uuid} value={o.uuid}>{o.name}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
