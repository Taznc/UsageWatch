import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../context/AppContext";
import type { Organization } from "../types/usage";

interface BrowserResult {
  browser: string;
  session_key: string | null;
  debug: string | null;
}

export function SetupWizard() {
  const { dispatch } = useApp();
  const [step, setStep] = useState(0);
  const [sessionKey, setSessionKey] = useState("");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [browserResults, setBrowserResults] = useState<BrowserResult[]>([]);
  const [error, setError] = useState("");

  const [selectedBrowser, setSelectedBrowser] = useState("");

  const scanBrowsers = async () => {
    setScanning(true);
    setError("");
    setBrowserResults([]);
    setSelectedBrowser("");
    try {
      const results = await invoke<BrowserResult[]>("pull_session_from_browsers");
      setBrowserResults(results);
      if (results.length === 0) {
        setError("No session found. Make sure you're logged into claude.ai in your browser.");
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const selectBrowserKey = (browser: string, key: string) => {
    setSessionKey(key);
    setSelectedBrowser(browser);
  };

  const testConnection = async () => {
    if (!sessionKey.trim()) {
      setError("Please enter a session key");
      return;
    }
    setTesting(true);
    setError("");
    try {
      const orgList = await invoke<Organization[]>("test_connection", {
        sessionKey: sessionKey.trim(),
      });
      setOrgs(orgList);
      if (orgList.length === 1) {
        setSelectedOrg(orgList[0].uuid);
      }
      setStep(2);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const finishSetup = async () => {
    if (!selectedOrg) {
      setError("Please select an organization");
      return;
    }
    setError("");
    try {
      await invoke("save_session_key", { key: sessionKey.trim() });
      await invoke("save_org_id", { orgId: selectedOrg });
      dispatch({ type: "SET_HAS_CREDENTIALS", has: true });
    } catch (e: any) {
      setError(String(e));
    }
  };

  return (
    <div className="setup-wizard">
      <div className="setup-header">
        <h1>UsageWatch</h1>
        <p className="setup-subtitle">Monitor AI usage limits across supported providers</p>
      </div>

      {step === 0 && (
        <div className="setup-step">
          <h2>Welcome</h2>
          <p>
            UsageWatch tracks provider usage and account limits across supported tools.
            To connect Claude, you'll need to be logged into claude.ai in your browser.
          </p>
          <button className="btn primary" onClick={() => setStep(1)}>
            Get Started
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="setup-step">
          <h2>Connect Your Account</h2>

          <button
            className="btn primary full-width"
            onClick={scanBrowsers}
            disabled={scanning}
          >
            {scanning ? "Scanning browsers..." : "Auto-detect from Browser"}
          </button>

          {browserResults.length > 0 && (
            <div className="browser-results">
              <p className="form-hint">
                {browserResults.length === 1
                  ? "Found a session — click to use it:"
                  : "Found sessions in multiple browsers — select one:"}
              </p>
              {browserResults.map((r) => (
                <div key={r.browser}>
                  <button
                    className={`btn full-width browser-option ${
                      selectedBrowser === r.browser ? "primary" : "secondary"
                    }`}
                    onClick={() => r.session_key && selectBrowserKey(r.browser, r.session_key)}
                    disabled={!r.session_key}
                  >
                    {r.browser}
                    {r.session_key ? "" : " (no session key)"}
                    {selectedBrowser === r.browser && " ✓"}
                  </button>
                  {r.debug && (
                    <pre className="debug-info">{r.debug}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {sessionKey && selectedBrowser && (
            <div className="form-success">
              Using session from {selectedBrowser}. Click Test Connection to continue.
            </div>
          )}

          <div className="divider">
            <span>or enter manually</span>
          </div>

          <div className="form-group">
            <label htmlFor="session-key">Session Key</label>
            <input
              id="session-key"
              type="password"
              value={sessionKey}
              onChange={(e) => setSessionKey(e.target.value)}
              placeholder="sk-ant-sid01-..."
              className="input"
            />
          </div>

          <p className="setup-hint">
            Open claude.ai → DevTools (F12) → Application → Cookies → copy{" "}
            <code>sessionKey</code>
          </p>

          {error && <div className="form-error">{error}</div>}
          <div className="btn-group">
            <button className="btn secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button
              className="btn primary"
              onClick={testConnection}
              disabled={testing || !sessionKey}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="setup-step">
          <h2>Select Organization</h2>
          <div className="form-group">
            <label htmlFor="org-select">Organization</label>
            <select
              id="org-select"
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              className="input"
            >
              <option value="">Select...</option>
              {orgs.map((org) => (
                <option key={org.uuid} value={org.uuid}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="btn-group">
            <button className="btn secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn primary" onClick={finishSetup}>
              Finish Setup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
