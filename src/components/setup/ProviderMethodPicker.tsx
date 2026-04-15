import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MethodCard } from "./MethodCard";
import { PROVIDER_METHODS, type CollectionMethod } from "../../types/setup";
import type { Provider, Organization } from "../../types/usage";

interface BrowserResult {
  browser: string;
  session_key: string | null;
  debug: string | null;
}

interface ProviderMethodPickerProps {
  provider: Provider;
  onConnected: () => void;
}

type MethodStatus = "idle" | "loading" | "success" | "error";

// Label shown for desktop-app source results in the browser picker
const DESKTOP_LABEL: Partial<Record<Provider, string>> = {
  Claude: "Claude Desktop",
  Codex: "ChatGPT Desktop",
};

export function ProviderMethodPicker({ provider, onConnected }: ProviderMethodPickerProps) {
  const methods = PROVIDER_METHODS[provider];

  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<string>("");

  // Claude-only: track which auth method is active and what alternatives exist
  const [currentAuthMethod, setCurrentAuthMethod] = useState<string>("session_key");
  const [hasSessionKey, setHasSessionKey] = useState(false);
  const [hasOAuth, setHasOAuth] = useState(false);

  const [activeMethod, setActiveMethod] = useState<CollectionMethod | null>(null);
  const [methodStatuses, setMethodStatuses] = useState<Record<CollectionMethod, MethodStatus>>({
    browser: "idle",
    desktop_app: "idle",
    manual: "idle",
    oauth_file: "idle",
  });
  const [methodErrors, setMethodErrors] = useState<Record<CollectionMethod, string>>({
    browser: "",
    desktop_app: "",
    manual: "",
    oauth_file: "",
  });

  // Browser scan results shared between "browser" method display
  const [browserResults, setBrowserResults] = useState<BrowserResult[]>([]);
  const [selectedBrowser, setSelectedBrowser] = useState<string>("");

  // Manual entry
  const [manualToken, setManualToken] = useState("");

  // Claude multi-org selection
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");

  useEffect(() => {
    checkStatus();
  }, [provider]);

  async function checkStatus() {
    setConnected(null);
    try {
      if (provider === "Claude") {
        const authMethod = await invoke<string>("get_claude_auth_method").catch(() => "session_key");
        setCurrentAuthMethod(authMethod);

        const oauthOk = await invoke<boolean>("check_claude_oauth").catch(() => false);
        setHasOAuth(oauthOk);

        const key = await invoke<string | null>("get_session_key");
        const org = await invoke<string | null>("get_org_id");
        setHasSessionKey(!!(key && org));

        if (authMethod === "oauth" && oauthOk) {
          setConnected(true);
          setConnectedInfo("Connected via Claude Code CLI");
          return;
        }
        if (key && org) {
          // Mark connected immediately — don't gate on test_connection succeeding.
          setConnected(true);
          setConnectedInfo("Connected");
          // Best-effort org name lookup (non-blocking, failures are silent).
          invoke<Organization[]>("test_connection", { sessionKey: key })
            .then((orgList) => {
              const match = orgList.find((o) => o.uuid === org);
              if (match) setConnectedInfo(match.name);
            })
            .catch(() => {/* keep "Connected" */});
        } else {
          setConnected(false);
        }
      } else if (provider === "Codex") {
        const ok = await invoke<boolean>("check_codex_auth");
        setConnected(ok);
        if (ok) setConnectedInfo("Authenticated");
      } else if (provider === "Cursor") {
        const ok = await invoke<boolean>("check_cursor_auth");
        setConnected(ok);
        if (ok) {
          const email = await invoke<string | null>("get_cursor_email");
          setConnectedInfo(email ?? "Authenticated");
        }
      }
    } catch {
      setConnected(false);
    }
  }

  function setStatus(method: CollectionMethod, status: MethodStatus, error = "") {
    setMethodStatuses((s) => ({ ...s, [method]: status }));
    setMethodErrors((e) => ({ ...e, [method]: error }));
  }

  function resetStates() {
    setActiveMethod(null);
    setBrowserResults([]);
    setSelectedBrowser("");
    setManualToken("");
    setOrgs([]);
    setSelectedOrg("");
    setMethodStatuses({ browser: "idle", desktop_app: "idle", manual: "idle", oauth_file: "idle" });
    setMethodErrors({ browser: "", desktop_app: "", manual: "", oauth_file: "" });
  }

  // ── Claude auth method switch ────────────────────────────────────────────

  async function switchAuthMethod(to: "oauth" | "session_key") {
    try {
      await invoke("set_claude_auth_method", { method: to });
      setCurrentAuthMethod(to);
      if (to === "oauth") {
        setConnectedInfo("Connected via Claude Code CLI");
      } else {
        // Refresh org name from stored session key
        const key = await invoke<string | null>("get_session_key");
        const org = await invoke<string | null>("get_org_id");
        if (key && org) {
          try {
            const orgList = await invoke<Organization[]>("test_connection", { sessionKey: key });
            const match = orgList.find((o) => o.uuid === org);
            setConnectedInfo(match?.name ?? "Connected");
          } catch {
            setConnectedInfo("Connected");
          }
        }
      }
    } catch (e: any) {
      console.error("Failed to switch auth method:", e);
    }
  }

  // ── Method handlers ─────────────────────────────────────────────────────

  async function handleBrowser() {
    setActiveMethod("browser");
    setStatus("browser", "loading");
    setBrowserResults([]);
    setSelectedBrowser("");
    try {
      const results = await invoke<BrowserResult[]>("scan_browsers", { provider });
      const valid = results.filter((r) => r.session_key);
      if (valid.length === 0) {
        const site = provider === "Claude" ? "claude.ai" : provider === "Codex" ? "chatgpt.com" : "cursor.com";
        setStatus("browser", "error", `No session found in any browser. Make sure you're signed into ${site}.`);
        return;
      }
      setBrowserResults(valid);
      // Auto-select preferred source (desktop app > first browser)
      const desktopLabel = DESKTOP_LABEL[provider];
      const preferred = desktopLabel
        ? (valid.find((r) => r.browser === desktopLabel) ?? valid[0])
        : valid[0];
      setSelectedBrowser(preferred.browser);
      setStatus("browser", "idle");
    } catch (e: any) {
      setStatus("browser", "error", String(e));
    }
  }

  async function handleDesktopApp() {
    setActiveMethod("desktop_app");
    setStatus("desktop_app", "loading");
    try {
      if (provider === "Codex") {
        const ok = await invoke<boolean>("check_codex_auth");
        if (!ok) {
          setStatus("desktop_app", "error", "~/.codex/auth.json not found or has no tokens. Run 'codex auth' first.");
          return;
        }
        setConnected(true);
        setConnectedInfo("Authenticated via ~/.codex/auth.json");
        setStatus("desktop_app", "success");
        onConnected();
      } else if (provider === "Cursor") {
        const ok = await invoke<boolean>("check_cursor_desktop_auth");
        if (!ok) {
          setStatus("desktop_app", "error", "Cursor app credentials not found. Open Cursor and sign in.");
          return;
        }
        setConnected(true);
        const email = await invoke<string | null>("get_cursor_email");
        setConnectedInfo(email ?? "Authenticated via Cursor app");
        setStatus("desktop_app", "success");
        onConnected();
      }
    } catch (e: any) {
      setStatus("desktop_app", "error", String(e));
    }
  }

  function handleManual() {
    setActiveMethod("manual");
    setManualToken("");
  }

  async function handleOAuthFile() {
    setActiveMethod("oauth_file");
    setStatus("oauth_file", "loading");
    try {
      const ok = await invoke<boolean>("check_claude_oauth");
      if (!ok) {
        setStatus(
          "oauth_file",
          "error",
          "Claude Code credentials not found. Sign in with the Claude CLI first by running 'claude' in a terminal."
        );
        return;
      }
      await invoke("set_claude_auth_method", { method: "oauth" });
      setConnected(true);
      setConnectedInfo("Connected via Claude Code CLI");
      setStatus("oauth_file", "success");
      onConnected();
    } catch (e: any) {
      setStatus("oauth_file", "error", String(e));
    }
  }

  // ── Save actions ────────────────────────────────────────────────────────

  async function saveBrowserSelection() {
    const result = browserResults.find((r) => r.browser === selectedBrowser);
    if (!result?.session_key) return;
    setStatus("browser", "loading");
    try {
      if (provider === "Claude") {
        const orgList = await invoke<Organization[]>("test_connection", { sessionKey: result.session_key });
        setOrgs(orgList);
        if (orgList.length === 1) {
          await finishClaudeSetup(result.session_key, orgList[0].uuid, orgList[0].name);
        } else {
          setStatus("browser", "idle");
        }
      } else if (provider === "Codex") {
        await invoke<boolean>("test_codex_browser_cookie", { cookie: result.session_key });
        await invoke("save_codex_browser_cookie", { cookie: result.session_key });
        setConnected(true);
        setConnectedInfo(`Authenticated via ${selectedBrowser}`);
        setStatus("browser", "success");
        onConnected();
      } else if (provider === "Cursor") {
        await invoke<boolean>("test_cursor_connection", { cookie: result.session_key });
        await invoke("save_cursor_token", { token: result.session_key });
        setConnected(true);
        const email = await invoke<string | null>("get_cursor_email");
        setConnectedInfo(email ?? `Authenticated via ${selectedBrowser}`);
        setStatus("browser", "success");
        onConnected();
      }
    } catch (e: any) {
      setStatus("browser", "error", String(e));
    }
  }

  async function saveManualToken() {
    if (!manualToken.trim()) return;
    setStatus("manual", "loading");
    try {
      if (provider === "Claude") {
        const orgList = await invoke<Organization[]>("test_connection", { sessionKey: manualToken.trim() });
        setOrgs(orgList);
        if (orgList.length === 1) {
          await finishClaudeSetup(manualToken.trim(), orgList[0].uuid, orgList[0].name);
        } else {
          setStatus("manual", "idle");
        }
      } else if (provider === "Codex") {
        await invoke<boolean>("test_codex_connection", { token: manualToken.trim() });
        await invoke("save_codex_token", { token: manualToken.trim() });
        setConnected(true);
        setConnectedInfo("Authenticated via manual token");
        setStatus("manual", "success");
        onConnected();
      } else if (provider === "Cursor") {
        await invoke<boolean>("test_cursor_connection", { cookie: manualToken.trim() });
        await invoke("save_cursor_token", { token: manualToken.trim() });
        setConnected(true);
        const email = await invoke<string | null>("get_cursor_email");
        setConnectedInfo(email ?? "Authenticated via manual token");
        setStatus("manual", "success");
        onConnected();
      }
    } catch (e: any) {
      setStatus("manual", "error", String(e));
    }
  }

  async function finishClaudeSetup(key: string, orgId: string, name: string) {
    await invoke("save_session_key", { key });
    await invoke("save_org_id", { orgId });
    setConnected(true);
    setConnectedInfo(name);
    setSelectedOrg(orgId);
    const method = activeMethod ?? "manual";
    setStatus(method, "success");
    onConnected();
  }

  async function selectClaudeOrg(orgId: string) {
    const org = orgs.find((o) => o.uuid === orgId);
    if (!org) return;
    const key =
      browserResults.find((r) => r.browser === selectedBrowser)?.session_key ??
      manualToken.trim();
    if (!key) return;
    await finishClaudeSetup(key, orgId, org.name);
  }

  // ── Per-provider hints ──────────────────────────────────────────────────

  const manualHint: Record<Provider, string> = {
    Claude: "Open claude.ai \u2192 DevTools (F12) \u2192 Application \u2192 Cookies \u2192 copy sessionKey",
    Codex: "Run 'codex auth' in a terminal, then copy the access_token from ~/.codex/auth.json",
    Cursor: "Open cursor.com/dashboard \u2192 DevTools (F12) \u2192 Application \u2192 Cookies \u2192 copy all cookies as a header string",
  };

  const manualPlaceholder: Record<Provider, string> = {
    Claude: "sk-ant-sid01-...",
    Codex: "eyJhbGciOi...",
    Cursor: "WorkosCursorSessionToken=...",
  };

  const desktopLabel = DESKTOP_LABEL[provider];

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="account-card">
      <div className="account-card-header">
        <div className="account-card-title">
          <span className="account-provider-name">{provider}</span>
          <span
            className={`account-status-badge ${
              connected === true ? "connected" : connected === false ? "disconnected" : "checking"
            }`}
          >
            {connected === null ? "Checking..." : connected ? "Connected" : "Not connected"}
          </span>
        </div>
        {connected && connectedInfo && (
          <p className="account-org-name">{connectedInfo}</p>
        )}
        {connected && provider === "Claude" && (
          <p className="account-org-name" style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
            Auth: {currentAuthMethod === "oauth" ? "Claude Code CLI" : "Session key"}
            {currentAuthMethod === "oauth" && hasSessionKey && (
              <button
                className="account-text-btn"
                style={{ marginLeft: 8, fontSize: 11 }}
                onClick={() => switchAuthMethod("session_key")}
              >
                switch to session key
              </button>
            )}
            {currentAuthMethod === "session_key" && hasOAuth && (
              <button
                className="account-text-btn"
                style={{ marginLeft: 8, fontSize: 11 }}
                onClick={() => switchAuthMethod("oauth")}
              >
                switch to Claude Code CLI
              </button>
            )}
          </p>
        )}
      </div>

      {/* Method cards */}
      {!connected && (
        <div className="method-card-list">
          {methods.map((m) => (
            <MethodCard
              key={m.method}
              config={m}
              status={methodStatuses[m.method]}
              error={methodErrors[m.method]}
              selected={activeMethod === m.method}
              onClick={() => {
                if (m.method === "browser") handleBrowser();
                else if (m.method === "desktop_app") handleDesktopApp();
                else if (m.method === "manual") handleManual();
                else if (m.method === "oauth_file") handleOAuthFile();
              }}
            />
          ))}
        </div>
      )}

      {/* Browser scan results */}
      {!connected && activeMethod === "browser" && browserResults.length > 0 && (
        <div className="scan-results">
          <p className="card-label">
            {browserResults.length === 1
              ? "Session found \u2014 click to use it:"
              : "Sessions found \u2014 select one:"}
          </p>
          {browserResults.map((r) => (
            <button
              key={r.browser}
              className={`scan-source-btn ${selectedBrowser === r.browser ? "selected" : ""}`}
              onClick={() => setSelectedBrowser(r.browser)}
            >
              <span className="scan-source-icon">
                {desktopLabel && r.browser === desktopLabel ? "\u25C6" : "\u25C9"}
              </span>
              {r.browser}
              {desktopLabel && r.browser === desktopLabel && (
                <span className="scan-source-recommended">recommended</span>
              )}
            </button>
          ))}
          {selectedBrowser && (
            <button
              className="btn primary"
              style={{ marginTop: 8, width: "100%" }}
              onClick={saveBrowserSelection}
              disabled={methodStatuses.browser === "loading"}
            >
              {methodStatuses.browser === "loading" ? "Verifying..." : "Use selected \u2014 save"}
            </button>
          )}
        </div>
      )}

      {/* Manual entry */}
      {!connected && activeMethod === "manual" && (
        <div className="method-manual-input">
          <div className="form-group">
            <label>{provider === "Claude" ? "Session key" : "Access token"}</label>
            <input
              type="password"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder={manualPlaceholder[provider]}
              className="input"
            />
          </div>
          <p className="setup-hint">{manualHint[provider]}</p>
          <button
            className="btn primary"
            style={{ width: "100%" }}
            onClick={saveManualToken}
            disabled={!manualToken.trim() || methodStatuses.manual === "loading"}
          >
            {methodStatuses.manual === "loading" ? "Testing..." : "Test & Save"}
          </button>
        </div>
      )}

      {/* Claude org selector */}
      {!connected && provider === "Claude" && orgs.length > 1 && (
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Organization</label>
          <select
            value={selectedOrg}
            onChange={(e) => selectClaudeOrg(e.target.value)}
            className="input"
          >
            <option value="">Select organization...</option>
            {orgs.map((org) => (
              <option key={org.uuid} value={org.uuid}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Reconnect */}
      {connected && (
        <button
          className="account-text-btn"
          onClick={() => {
            setConnected(false);
            setConnectedInfo("");
            resetStates();
          }}
          style={{ marginTop: 8 }}
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
