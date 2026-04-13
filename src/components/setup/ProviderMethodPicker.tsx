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

export function ProviderMethodPicker({ provider, onConnected }: ProviderMethodPickerProps) {
  const methods = PROVIDER_METHODS[provider];

  // Connection status
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<string>("");

  // Active method + states
  const [activeMethod, setActiveMethod] = useState<CollectionMethod | null>(null);
  const [methodStatuses, setMethodStatuses] = useState<Record<CollectionMethod, MethodStatus>>({
    browser: "idle",
    desktop_app: "idle",
    manual: "idle",
  });
  const [methodErrors, setMethodErrors] = useState<Record<CollectionMethod, string>>({
    browser: "",
    desktop_app: "",
    manual: "",
  });

  // Browser scan results
  const [browserResults, setBrowserResults] = useState<BrowserResult[]>([]);
  const [selectedBrowser, setSelectedBrowser] = useState<string>("");

  // Manual entry
  const [manualToken, setManualToken] = useState("");

  // Claude-specific: org selection
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");

  // Check current connection status on mount
  useEffect(() => {
    checkStatus();
  }, [provider]);

  async function checkStatus() {
    setConnected(null);
    try {
      if (provider === "Claude") {
        const key = await invoke<string | null>("get_session_key");
        const org = await invoke<string | null>("get_org_id");
        if (key && org) {
          setConnected(true);
          // Try to get org name
          try {
            const orgList = await invoke<Organization[]>("test_connection", { sessionKey: key });
            const match = orgList.find((o) => o.uuid === org);
            if (match) setConnectedInfo(match.name);
          } catch {
            setConnectedInfo("Connected");
          }
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
    setMethodStatuses({ browser: "idle", desktop_app: "idle", manual: "idle" });
    setMethodErrors({ browser: "", desktop_app: "", manual: "" });
  }

  // ── Method handlers ─────────────────────────────────────────────────────

  async function handleBrowser() {
    setActiveMethod("browser");
    setStatus("browser", "loading");
    setBrowserResults([]);
    setSelectedBrowser("");
    try {
      let results: BrowserResult[];
      if (provider === "Claude") {
        results = await invoke<BrowserResult[]>("pull_session_from_browsers");
      } else if (provider === "Codex") {
        results = await invoke<BrowserResult[]>("pull_codex_session_from_browsers");
      } else {
        results = await invoke<BrowserResult[]>("pull_cursor_session_from_browsers");
      }
      const valid = results.filter((r) => r.session_key);
      if (valid.length === 0) {
        const loginSite = provider === "Claude" ? "claude.ai" : provider === "Codex" ? "chatgpt.com" : "cursor.com";
        setStatus("browser", "error", `No session found in any browser. Make sure you're logged into ${loginSite}.`);
        return;
      }
      setBrowserResults(valid);
      // Auto-select first (or prefer the desktop app for Claude/Codex)
      const preferred =
        provider === "Claude" ? (valid.find((r) => r.browser === "Claude Desktop") ?? valid[0])
        : provider === "Codex" ? (valid.find((r) => r.browser === "ChatGPT Desktop") ?? valid[0])
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
      if (provider === "Claude") {
        // Claude Desktop is included in the browser scan (appears as "Claude Desktop")
        let results: BrowserResult[];
        try {
          results = await invoke<BrowserResult[]>("pull_session_from_browsers");
        } catch (e: any) {
          const msg = String(e);
          if (msg.includes("being used by another process") || msg.includes("sharing") || msg.includes("os error 32")) {
            setStatus("desktop_app", "error", "Claude Desktop has its cookie file locked. Close Claude Desktop and try again, or use Browser Cookies instead (log into claude.ai in Chrome/Edge).");
          } else {
            setStatus("desktop_app", "error", msg);
          }
          return;
        }
        const desktop = results.find((r) => r.browser === "Claude Desktop" && r.session_key);
        if (!desktop) {
          const hasDesktopEntry = results.find((r) => r.browser === "Claude Desktop");
          if (hasDesktopEntry) {
            setStatus("desktop_app", "error", "Claude Desktop cookie file is locked. Close Claude Desktop and try again, or use Browser Cookies instead (log into claude.ai in Chrome/Edge).");
          } else {
            setStatus("desktop_app", "error", "Claude Desktop session not found. Make sure you're signed in, or close and reopen Claude Desktop.");
          }
          return;
        }
        setBrowserResults([desktop]);
        setSelectedBrowser("Claude Desktop");
        setStatus("desktop_app", "idle");
      } else if (provider === "Codex") {
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

  // ── Save actions ────────────────────────────────────────────────────────

  async function saveBrowserSelection() {
    const result = browserResults.find((r) => r.browser === selectedBrowser);
    if (!result?.session_key) return;

    const method = activeMethod ?? "browser";
    setStatus(method, "loading");
    try {
      if (provider === "Claude") {
        const orgList = await invoke<Organization[]>("test_connection", { sessionKey: result.session_key });
        setOrgs(orgList);
        if (orgList.length === 1) {
          await finishClaudeSetup(result.session_key, orgList[0].uuid, orgList[0].name);
        } else {
          // Need org selection
          setStatus(method, "idle");
        }
      } else if (provider === "Codex") {
        await invoke<boolean>("test_codex_browser_cookie", { cookie: result.session_key });
        await invoke("save_codex_browser_cookie", { cookie: result.session_key });
        setConnected(true);
        setConnectedInfo(`Authenticated via ${selectedBrowser} (chatgpt.com)`);
        setStatus(method, "success");
        onConnected();
      } else if (provider === "Cursor") {
        await invoke<boolean>("test_cursor_connection", { cookie: result.session_key });
        await invoke("save_cursor_token", { token: result.session_key });
        setConnected(true);
        const email = await invoke<string | null>("get_cursor_email");
        setConnectedInfo(email ?? `Authenticated via ${selectedBrowser}`);
        setStatus(method, "success");
        onConnected();
      }
    } catch (e: any) {
      setStatus(method, "error", String(e));
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
    const method = activeMethod ?? "browser";
    setStatus(method, "success");
    onConnected();
  }

  async function selectClaudeOrg(orgId: string) {
    const org = orgs.find((o) => o.uuid === orgId);
    if (!org) return;
    // Get the key from the browser result or manual entry
    const key =
      browserResults.find((r) => r.browser === selectedBrowser)?.session_key ??
      manualToken.trim();
    if (!key) return;
    await finishClaudeSetup(key, orgId, org.name);
  }

  // ── Manual entry hints ──────────────────────────────────────────────────

  const manualHint: Record<Provider, string> = {
    Claude: "Open claude.ai \u2192 DevTools (F12) \u2192 Application \u2192 Cookies \u2192 copy sessionKey",
    Codex: "Run 'codex auth' in a terminal, then copy the access_token from ~/.codex/auth.json",
    Cursor: "Open cursor.com/dashboard in a browser \u2192 DevTools (F12) \u2192 Application \u2192 Cookies \u2192 copy all cookies as header string",
  };

  const manualPlaceholder: Record<Provider, string> = {
    Claude: "sk-ant-sid01-...",
    Codex: "eyJhbGciOi...",
    Cursor: "WorkosCursorSessionToken=...",
  };

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
              }}
            />
          ))}
        </div>
      )}

      {/* Browser scan results */}
      {!connected && browserResults.length > 0 && (activeMethod === "browser" || activeMethod === "desktop_app") && (
        <div className="scan-results">
          <p className="card-label">
            {browserResults.length === 1
              ? "Found a session \u2014 click to use it:"
              : "Found sessions \u2014 select one:"}
          </p>
          {browserResults.map((r) => (
            <button
              key={r.browser}
              className={`scan-source-btn ${selectedBrowser === r.browser ? "selected" : ""}`}
              onClick={() => setSelectedBrowser(r.browser)}
            >
              <span className="scan-source-icon">
                {r.browser === "Claude Desktop" ? "\u25C6" : "\u25C9"}
              </span>
              {r.browser}
              {r.browser === "Claude Desktop" && (
                <span className="scan-source-recommended">recommended</span>
              )}
            </button>
          ))}
          {selectedBrowser && (
            <button
              className="btn primary"
              style={{ marginTop: 8, width: "100%" }}
              onClick={saveBrowserSelection}
              disabled={methodStatuses[activeMethod!] === "loading"}
            >
              {methodStatuses[activeMethod!] === "loading" ? "Verifying..." : "Use selected & save"}
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

      {/* Claude org selector (when multiple orgs returned) */}
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

      {/* Reconnect button when already connected */}
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
