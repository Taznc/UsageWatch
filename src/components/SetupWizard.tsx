import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../context/AppContext";
import type { Organization } from "../types/usage";

export function SetupWizard() {
  const { dispatch } = useApp();
  const [step, setStep] = useState(0);
  const [sessionKey, setSessionKey] = useState("");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

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
        <h1>Claude Usage Tracker</h1>
        <p className="setup-subtitle">Monitor your Claude AI usage limits</p>
      </div>

      {step === 0 && (
        <div className="setup-step">
          <h2>Welcome</h2>
          <p>
            This app monitors your Claude usage limits by polling the Claude API.
            You'll need your session key to get started.
          </p>
          <p className="setup-hint">
            To find your session key, open claude.ai in your browser, open DevTools
            (F12), go to Application &gt; Cookies, and copy the value of{" "}
            <code>sessionKey</code>.
          </p>
          <button className="btn primary" onClick={() => setStep(1)}>
            Get Started
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="setup-step">
          <h2>Enter Session Key</h2>
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
          {error && <div className="form-error">{error}</div>}
          <div className="btn-group">
            <button className="btn secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button
              className="btn primary"
              onClick={testConnection}
              disabled={testing}
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
