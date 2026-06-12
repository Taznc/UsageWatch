//! Multi-account Claude support.
//!
//! UsageWatch can detect several Claude accounts (the main Claude Desktop profile,
//! per-instance profiles under `~/.claude-instances/*`, browser sessions, manual
//! entry). Each detected account is persisted in `credentials.json` under
//! `claude_accounts`, and `active_claude_account_id` records which one is shown.
//!
//! The active account is *mirrored* into the legacy `session_key` / `org_id` store
//! keys and the in-memory [`CredentialsCache`], so the entire polling / usage / tray
//! / HTTP-server pipeline keeps reading those and needs no changes.

use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;

use crate::credentials_cache::CredentialsCache;
use crate::models::Organization;
use crate::polling::{self, BillingUpdate, CodexUpdate, CursorUpdate, UsageUpdate};
use super::credentials::{save_json_to_store, save_to_store};

const ACCOUNTS_KEY: &str = "claude_accounts";
const ACTIVE_KEY: &str = "active_claude_account_id";

/// A stored Claude account. `session_key` may be a bare key or a full
/// `name=val; ...` cookie header — `claude_cookie_header` accepts both.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeAccount {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub session_key: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub org_name: String,
    #[serde(default)]
    pub added_at: String,
    #[serde(default)]
    pub last_verified: String,
}

/// Redacted, frontend-facing view of an account — never ships the raw session key.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeAccountView {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub source: String,
    pub org_id: String,
    pub org_name: String,
    pub added_at: String,
    pub last_verified: String,
    pub has_session: bool,
    pub is_active: bool,
}

/// One row returned by [`rescan_claude_accounts`] — either a verified/added account,
/// an error (locked DB, expired session), or a multi-org prompt needing user choice.
#[derive(Debug, Clone, Serialize)]
pub struct RescanRow {
    pub instance: String,
    pub account: Option<ClaudeAccountView>,
    pub error: Option<String>,
    /// For accounts with multiple orgs — the choices to present to the user.
    pub orgs: Option<Vec<Organization>>,
    /// Session key for the multi-org completion path only (so `add_claude_account`
    /// can finish without re-scanning). `None` for resolved/errored rows.
    pub pending_session_key: Option<String>,
}

// ── Store helpers ───────────────────────────────────────────────────────────

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn read_accounts(app: &AppHandle) -> Vec<ClaudeAccount> {
    let Ok(store) = app.store("credentials.json") else { return Vec::new(); };
    match store.get(ACCOUNTS_KEY) {
        Some(val) => serde_json::from_value(val).unwrap_or_default(),
        None => Vec::new(),
    }
}

fn write_accounts(app: &AppHandle, accounts: &[ClaudeAccount]) -> Result<(), String> {
    save_json_to_store(app, ACCOUNTS_KEY, serde_json::to_value(accounts).map_err(|e| e.to_string())?)
}

fn read_active_id(app: &AppHandle) -> Option<String> {
    let store = app.store("credentials.json").ok()?;
    store.get(ACTIVE_KEY).and_then(|v| v.as_str().map(String::from))
}

fn save_active_id(app: &AppHandle, id: &str) -> Result<(), String> {
    save_to_store(app, ACTIVE_KEY, id)
}

fn view_of(acct: &ClaudeAccount, active_id: Option<&str>) -> ClaudeAccountView {
    ClaudeAccountView {
        id: acct.id.clone(),
        label: acct.label.clone(),
        email: acct.email.clone(),
        display_name: acct.display_name.clone(),
        source: acct.source.clone(),
        org_id: acct.org_id.clone(),
        org_name: acct.org_name.clone(),
        added_at: acct.added_at.clone(),
        last_verified: acct.last_verified.clone(),
        has_session: !acct.session_key.is_empty(),
        is_active: active_id == Some(acct.id.as_str()),
    }
}

/// Insert or update an account. Dedupes by exact id, then by non-empty org_id so the
/// same Claude org detected via different sources collapses to one stable entry.
/// Returns the resulting account.
fn upsert_account(accounts: &mut Vec<ClaudeAccount>, mut new: ClaudeAccount) -> ClaudeAccount {
    if let Some(existing) = accounts.iter_mut().find(|a| a.id == new.id) {
        new.added_at = existing.added_at.clone();
        *existing = new.clone();
        return new;
    }
    if !new.org_id.is_empty() {
        if let Some(existing) = accounts.iter_mut().find(|a| a.org_id == new.org_id) {
            new.id = existing.id.clone();
            new.added_at = existing.added_at.clone();
            *existing = new.clone();
            return new;
        }
    }
    accounts.push(new.clone());
    new
}

/// Mirror an account's credentials into the legacy store keys + cache so the rest of
/// the app (polling, tray, http_server) transparently uses the active account.
fn mirror_active(app: &AppHandle, cache: &CredentialsCache, acct: &ClaudeAccount) -> Result<(), String> {
    save_to_store(app, "session_key", &acct.session_key)?;
    save_to_store(app, "org_id", &acct.org_id)?;
    save_to_store(app, "claude_auth_method", "session_key")?;
    cache.set_session_key(acct.session_key.clone());
    cache.set_org_id(acct.org_id.clone());
    cache.set_claude_auth_method("session_key".to_string());
    Ok(())
}

fn account_id_for_instance(instance: &str) -> String {
    if instance == "main" {
        "appdata:main".to_string()
    } else {
        format!("instance:{instance}")
    }
}

fn source_for_instance(instance: &str) -> String {
    if instance == "main" { "claude_desktop".to_string() } else { "claude_instance".to_string() }
}

// ── Startup migration ───────────────────────────────────────────────────────

/// Called once at startup. If a legacy single `session_key` exists but there's no
/// account array yet, wrap it as a "Default" account and make it active. Otherwise,
/// ensure the active account's credentials are mirrored into cache (self-heals any
/// divergence between the account array and the legacy keys).
pub fn migrate_and_sync(app: &AppHandle, cache: &CredentialsCache) {
    let mut accounts = read_accounts(app);

    if accounts.is_empty() {
        // Legacy → wrap existing single credential, if present.
        let Ok(store) = app.store("credentials.json") else { return; };
        let session_key = store.get("session_key").and_then(|v| v.as_str().map(String::from));
        let org_id = store.get("org_id").and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        if let Some(session_key) = session_key.filter(|s| !s.is_empty()) {
            let acct = ClaudeAccount {
                id: "legacy:default".to_string(),
                label: "Default".to_string(),
                email: None,
                display_name: None,
                source: "legacy".to_string(),
                session_key,
                org_id,
                org_name: String::new(),
                added_at: now_iso(),
                last_verified: now_iso(),
            };
            accounts.push(acct.clone());
            let _ = write_accounts(app, &accounts);
            let _ = save_active_id(app, &acct.id);
        }
        return;
    }

    // Accounts exist — make sure the active one is mirrored into the cache.
    let active_id = read_active_id(app);
    let active = active_id
        .as_deref()
        .and_then(|id| accounts.iter().find(|a| a.id == id))
        .or_else(|| accounts.first());
    if let Some(acct) = active {
        let _ = mirror_active(app, cache, acct);
        if active_id.is_none() {
            let _ = save_active_id(app, &acct.id);
        }
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_claude_accounts(app: AppHandle) -> Vec<ClaudeAccountView> {
    let accounts = read_accounts(&app);
    let active = read_active_id(&app);
    accounts.iter().map(|a| view_of(a, active.as_deref())).collect()
}

/// Detect every Claude Desktop instance, verify each readable session against the
/// Claude API, and upsert verified accounts. Returns one row per instance describing
/// the outcome (added / error / needs-org-choice).
#[tauri::command]
pub async fn rescan_claude_accounts(
    app: AppHandle,
    cache: State<'_, Arc<CredentialsCache>>,
    latest_usage: State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
    latest_codex: State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
    latest_cursor: State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
    latest_billing: State<'_, Arc<Mutex<Option<BillingUpdate>>>>,
) -> Result<Vec<RescanRow>, String> {
    let instances = super::browser::scan_claude_instances();
    let mut accounts = read_accounts(&app);
    let had_active = read_active_id(&app).is_some();
    let mut rows: Vec<RescanRow> = Vec::new();

    for inst in instances {
        let Some(session_key) = inst.session_key.clone() else {
            rows.push(RescanRow {
                instance: inst.label.clone(),
                account: None,
                error: inst.error.clone(),
                orgs: None,
                pending_session_key: None,
            });
            continue;
        };

        match super::credentials::test_connection(session_key.clone()).await {
            Ok(orgs) if orgs.is_empty() => rows.push(RescanRow {
                instance: inst.label.clone(),
                account: None,
                error: Some("No organizations on this account.".to_string()),
                orgs: None,
                pending_session_key: None,
            }),
            Ok(orgs) => {
                let chosen = inst.org_id.as_deref()
                    .and_then(|hint| orgs.iter().find(|o| o.uuid == hint))
                    .or_else(|| if orgs.len() == 1 { orgs.first() } else { None })
                    .cloned();
                match chosen {
                    Some(org) => {
                        let acct = upsert_account(&mut accounts, ClaudeAccount {
                            id: account_id_for_instance(&inst.instance),
                            label: inst.label.clone(),
                            email: inst.email.clone(),
                            display_name: inst.display_name.clone(),
                            source: source_for_instance(&inst.instance),
                            session_key: session_key.clone(),
                            org_id: org.uuid.clone(),
                            org_name: org.name.clone(),
                            added_at: now_iso(),
                            last_verified: now_iso(),
                        });
                        rows.push(RescanRow {
                            instance: inst.label.clone(),
                            account: Some(view_of(&acct, None)),
                            error: None,
                            orgs: None,
                            pending_session_key: None,
                        });
                    }
                    None => rows.push(RescanRow {
                        instance: inst.label.clone(),
                        account: None,
                        error: None,
                        orgs: Some(orgs),
                        pending_session_key: Some(session_key.clone()),
                    }),
                }
            }
            Err(e) => rows.push(RescanRow {
                instance: inst.label.clone(),
                account: None,
                error: Some(format!("Session found but verification failed: {e}")),
                orgs: None,
                pending_session_key: None,
            }),
        }
    }

    write_accounts(&app, &accounts)?;

    // First-time setup: if nothing was active, activate the first detected account
    // and poll immediately so the UI doesn't sit empty until the next tick.
    if !had_active {
        if let Some(first) = accounts.first().cloned() {
            mirror_active(&app, &cache, &first)?;
            save_active_id(&app, &first.id)?;
            let _ = app.emit("claude-account-changed", &first.id);
            polling::poll_all_providers(
                &app, &**cache, &*latest_usage, &*latest_codex, &*latest_cursor, &*latest_billing,
            ).await;
        }
    }

    // Fix up is_active flags now that the active id is settled.
    let active = read_active_id(&app);
    for row in rows.iter_mut() {
        if let Some(v) = row.account.as_mut() {
            v.is_active = active.as_deref() == Some(v.id.as_str());
        }
    }

    Ok(rows)
}

/// Add or update an account (manual/browser setup, or completing a multi-org rescan
/// row), and optionally activate it. Replaces the old `save_session_key` + `save_org_id`
/// pair for Claude setup so every successful auth registers an account.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn add_claude_account(
    app: AppHandle,
    cache: State<'_, Arc<CredentialsCache>>,
    latest_usage: State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
    latest_codex: State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
    latest_cursor: State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
    latest_billing: State<'_, Arc<Mutex<Option<BillingUpdate>>>>,
    label: String,
    session_key: String,
    org_id: String,
    org_name: String,
    email: Option<String>,
    source: Option<String>,
    set_active: Option<bool>,
) -> Result<ClaudeAccountView, String> {
    let source = source.unwrap_or_else(|| "manual".to_string());
    let id = if org_id.is_empty() {
        format!("{source}:{label}")
    } else {
        format!("{source}:{org_id}")
    };

    let mut accounts = read_accounts(&app);
    let acct = upsert_account(&mut accounts, ClaudeAccount {
        id,
        label,
        email,
        display_name: None,
        source,
        session_key,
        org_id,
        org_name,
        added_at: now_iso(),
        last_verified: now_iso(),
    });
    write_accounts(&app, &accounts)?;

    let activate = set_active.unwrap_or(true);
    if activate {
        mirror_active(&app, &cache, &acct)?;
        save_active_id(&app, &acct.id)?;
        let _ = app.emit("claude-account-changed", &acct.id);
        polling::poll_all_providers(
            &app, &**cache, &*latest_usage, &*latest_codex, &*latest_cursor, &*latest_billing,
        ).await;
    }

    let active = read_active_id(&app);
    Ok(view_of(&acct, active.as_deref()))
}

/// Switch the active account. Mirrors its credentials into the legacy keys + cache,
/// emits `claude-account-changed`, and re-polls so the tray/UI refresh immediately.
#[tauri::command]
pub async fn set_active_claude_account(
    app: AppHandle,
    cache: State<'_, Arc<CredentialsCache>>,
    latest_usage: State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
    latest_codex: State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
    latest_cursor: State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
    latest_billing: State<'_, Arc<Mutex<Option<BillingUpdate>>>>,
    id: String,
) -> Result<(), String> {
    let accounts = read_accounts(&app);
    let acct = accounts.into_iter().find(|a| a.id == id)
        .ok_or_else(|| format!("Account not found: {id}"))?;

    mirror_active(&app, &cache, &acct)?;
    save_active_id(&app, &id)?;
    let _ = app.emit("claude-account-changed", &id);
    polling::poll_all_providers(
        &app, &**cache, &*latest_usage, &*latest_codex, &*latest_cursor, &*latest_billing,
    ).await;
    Ok(())
}

/// Remove an account. If it was active, promote the first remaining account (mirroring
/// its credentials); if none remain, clear the legacy keys + cache so the app returns
/// to an unconfigured state.
#[tauri::command]
pub async fn remove_claude_account(
    app: AppHandle,
    cache: State<'_, Arc<CredentialsCache>>,
    latest_usage: State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
    latest_codex: State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
    latest_cursor: State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
    latest_billing: State<'_, Arc<Mutex<Option<BillingUpdate>>>>,
    id: String,
) -> Result<(), String> {
    let mut accounts = read_accounts(&app);
    let was_active = read_active_id(&app).as_deref() == Some(id.as_str());
    accounts.retain(|a| a.id != id);
    write_accounts(&app, &accounts)?;

    if was_active {
        match accounts.first().cloned() {
            Some(next) => {
                mirror_active(&app, &cache, &next)?;
                save_active_id(&app, &next.id)?;
                let _ = app.emit("claude-account-changed", &next.id);
            }
            None => {
                // No accounts left — clear the active credential entirely.
                super::credentials::delete_from_store(&app, "session_key")?;
                super::credentials::delete_from_store(&app, "org_id")?;
                super::credentials::delete_from_store(&app, ACTIVE_KEY)?;
                cache.clear_session_key();
                let _ = app.emit("claude-account-changed", "");
            }
        }
        polling::poll_all_providers(
            &app, &**cache, &*latest_usage, &*latest_codex, &*latest_cursor, &*latest_billing,
        ).await;
    }

    Ok(())
}
