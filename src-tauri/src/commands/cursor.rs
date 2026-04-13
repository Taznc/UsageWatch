use std::path::PathBuf;

// ── Auth path resolution ───────────────────────────────────────────────────
//
// Cursor stores credentials in VS Code's globalStorage format.
// On macOS/Linux these are in storage.json as flat dot-separated keys.
// On Windows they're in a SQLite database (state.vscdb) in the ItemTable.
//
// Keys:
//   "cursorAuth/accessToken"   — Bearer token for Cursor API calls
//   "cursorAuth/cachedEmail"   — The signed-in user's email
//
// Paths by platform:
//   macOS:   ~/Library/Application Support/Cursor/User/globalStorage/
//   Windows: %APPDATA%\Cursor\User\globalStorage\
//   Linux:   ~/.config/Cursor/User/globalStorage/

fn cursor_global_storage_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support/Cursor/User/globalStorage"),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("Cursor/User/globalStorage"),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config/Cursor/User/globalStorage"),
        )
    }
}

/// Read a value from the Cursor globalStorage, trying storage.json first
/// then falling back to state.vscdb (SQLite).
fn read_cursor_key(key: &str) -> Option<String> {
    let dir = cursor_global_storage_dir()?;

    // Try storage.json first (used on macOS/Linux)
    let json_path = dir.join("storage.json");
    if json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(val) = json.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                    return Some(val.to_owned());
                }
            }
        }
    }

    // Fall back to state.vscdb (SQLite, used on Windows)
    let db_path = dir.join("state.vscdb");
    if db_path.exists() {
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            let result: Option<String> = conn
                .query_row(
                    "SELECT value FROM ItemTable WHERE key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .ok()
                .filter(|s: &String| !s.is_empty());
            if result.is_some() {
                return result;
            }
        }
    }

    None
}

// ── Browser cookie extraction ─────────────────────────────────────────────

use crate::models::{BrowserResult, CursorUsageData};
use rookie::common::enums::Cookie;

type BrowserFn = fn(Option<Vec<String>>) -> rookie::Result<Vec<Cookie>>;

fn cursor_browser_list() -> Vec<(&'static str, BrowserFn)> {
    vec![
        ("Chrome", rookie::chrome),
        ("Firefox", rookie::firefox),
        ("Zen", rookie::zen),
        ("Arc", rookie::arc),
        ("Brave", rookie::brave),
        ("Edge", rookie::edge),
        ("Vivaldi", rookie::vivaldi),
        ("Opera", rookie::opera),
        ("Chromium", rookie::chromium),
        #[cfg(target_os = "macos")]
        ("Safari", rookie::safari),
    ]
}

/// Build a cookie header string from all cookies for cursor.com found in any browser.
/// Returns the first browser that has cookies (used by polling).
fn get_cursor_session_cookie() -> Option<String> {
    let domains = Some(vec!["cursor.com".to_string()]);

    for (_name, fetch_fn) in cursor_browser_list() {
        match fetch_fn(domains.clone()) {
            Ok(cookies) if !cookies.is_empty() => {
                let cookie_str: String = cookies
                    .iter()
                    .map(|c| format!("{}={}", c.name, c.value))
                    .collect::<Vec<_>>()
                    .join("; ");
                return Some(cookie_str);
            }
            _ => {}
        }
    }

    None
}

/// Scan all browsers for cursor.com session cookies, returning per-browser results.
fn scan_cursor_browsers() -> Vec<BrowserResult> {
    let domains = Some(vec!["cursor.com".to_string()]);
    let mut results = Vec::new();

    for (name, fetch_fn) in cursor_browser_list() {
        match fetch_fn(domains.clone()) {
            Ok(cookies) if !cookies.is_empty() => {
                let cookie_str: String = cookies
                    .iter()
                    .map(|c| format!("{}={}", c.name, c.value))
                    .collect::<Vec<_>>()
                    .join("; ");
                results.push(BrowserResult {
                    browser: name.to_string(),
                    session_key: Some(cookie_str),
                    debug: Some(format!("cookies={}", cookies.len())),
                });
            }
            Ok(cookies) if cookies.is_empty() => {}
            Ok(_) => {}
            Err(e) => {
                eprintln!("[cursor-scan] {}: error: {:?}", name, e);
            }
        }
    }

    results
}

// ── Cookie bearer extraction ──────────────────────────────────────────────
//
// Browser session cookies carry the bearer token inside them:
//   WorkosCursorSessionToken=<userId>%3A%3A<access_token>
// URL-decoding and splitting on "::" gives us the bearer we need for
// the Connect RPC endpoints (api2.cursor.sh), which only accept Bearer auth.

fn extract_bearer_from_cookie(cookie_str: &str) -> Option<String> {
    let prefix = "WorkosCursorSessionToken=";
    let start = cookie_str.find(prefix)? + prefix.len();
    let end = cookie_str[start..].find(';').map(|i| start + i).unwrap_or(cookie_str.len());
    let raw = cookie_str[start..end].trim();
    // URL-decode %3A -> ':'
    let decoded = raw.replace("%3A", ":").replace("%3a", ":");
    // Split on first "::" — left is userId, right is access_token
    let sep = decoded.find("::")?;
    let token = decoded[sep + 2..].to_string();
    if token.is_empty() { None } else { Some(token) }
}

// ── API fetch ─────────────────────────────────────────────────────────────
//
// Primary endpoint: Connect RPC v1 on api2.cursor.sh (requires Bearer auth).
// Stripe endpoint:  cursor.com/api/auth/stripe (requires session cookie).
//
// Auth resolution:
//   1. Browser cookie  → extract bearer from WorkosCursorSessionToken
//   2. Manual token    → bearer if no '=' chars, otherwise treat as cookie and extract
//   3. Desktop token   → read cursorAuth/accessToken from storage.json / state.vscdb

pub(crate) async fn fetch_cursor_usage_internal(manual_token: Option<String>) -> Result<CursorUsageData, String> {
    // Resolve session cookie (for Stripe endpoint) and bearer token (for RPC) separately.
    let session_cookie: Option<String> = get_cursor_session_cookie()
        .or_else(|| manual_token.as_ref().filter(|t| t.contains('=') || t.contains(';')).cloned());

    let bearer: String = session_cookie.as_deref()
        .and_then(extract_bearer_from_cookie)
        .or_else(|| manual_token.as_ref().filter(|t| !t.contains('=') && !t.contains(';')).cloned())
        .or_else(|| read_cursor_key("cursorAuth/accessToken"))
        .ok_or_else(|| "No Cursor auth found — sign into the Cursor desktop app, log into cursor.com/dashboard in your browser, or enter a token manually.".to_string())?;

    let email = read_cursor_key("cursorAuth/cachedEmail");
    let client = reqwest::Client::new();

    // Helper: POST a Connect RPC method and parse as JSON.
    async fn rpc(
        client: &reqwest::Client,
        method: &str,
        bearer: &str,
    ) -> Option<serde_json::Value> {
        let url = format!("https://api2.cursor.sh/aiserver.v1.DashboardService/{method}");
        match client
            .post(&url)
            .bearer_auth(bearer)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .header("User-Agent", crate::USER_AGENT)
            .body("{}")
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            Ok(resp) => {
                eprintln!("[Cursor] {method}: HTTP {}", resp.status());
                None
            }
            Err(e) => {
                eprintln!("[Cursor] {method}: {e}");
                None
            }
        }
    }

    // Fire all three fetches in parallel.
    let (usage_json, plan_json, stripe_json) = tokio::join!(
        rpc(&client, "GetCurrentPeriodUsage", &bearer),
        rpc(&client, "GetPlanInfo", &bearer),
        async {
            // Stripe balance requires the session cookie, not bearer auth.
            let Some(cookie) = &session_cookie else { return None };
            match client
                .get("https://cursor.com/api/auth/stripe")
                .header("Cookie", cookie)
                .header("User-Agent", crate::USER_AGENT)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => resp.json::<serde_json::Value>().await.ok(),
                _ => None,
            }
        },
    );

    // ── Parse GetCurrentPeriodUsage ───────────────────────────────────────

    let plan_usage = usage_json.as_ref().and_then(|v| v.get("planUsage"));

    let included_spend = plan_usage.and_then(|p| p.get("includedSpend")?.as_f64()).unwrap_or(0.0);
    let limit_cents    = plan_usage.and_then(|p| p.get("limit")?.as_f64()).unwrap_or(0.0);
    let total_pct      = plan_usage.and_then(|p| p.get("totalPercentUsed")?.as_f64()).filter(|v| v.is_finite());
    let auto_pct       = plan_usage.and_then(|p| p.get("autoPercentUsed")?.as_f64()).filter(|v| v.is_finite());
    let api_pct        = plan_usage.and_then(|p| p.get("apiPercentUsed")?.as_f64()).filter(|v| v.is_finite());
    let remaining_bonus = plan_usage.and_then(|p| p.get("remainingBonus")?.as_bool()).unwrap_or(false);

    let spend_limit = usage_json.as_ref().and_then(|v| v.get("spendLimitUsage"));
    let on_demand_used  = spend_limit.and_then(|s| s.get("individualUsed")?.as_f64()).filter(|&v| v > 0.0);
    let on_demand_limit = spend_limit.and_then(|s| s.get("individualLimit")?.as_f64()).filter(|&v| v > 0.0);
    let is_team = spend_limit.map(|s| {
        s.get("limitType").and_then(|v| v.as_str()) == Some("team")
        || s.get("pooledLimit").is_some()
    }).unwrap_or(false);

    // billingCycleEnd is a unix-millisecond string ("1771077734000")
    let cycle_end: Option<String> = usage_json.as_ref()
        .and_then(|v| v.get("billingCycleEnd")?.as_str()?.parse::<i64>().ok())
        .and_then(|ms| chrono::DateTime::from_timestamp(ms / 1000, 0))
        .map(|dt| dt.to_rfc3339());

    // ── Parse GetPlanInfo ─────────────────────────────────────────────────

    let plan_name: Option<String> = plan_json
        .and_then(|v| v.get("planInfo")?.get("planName")?.as_str().map(|s| s.to_string()));

    // ── Parse Stripe balance ──────────────────────────────────────────────
    // customerBalance is in cents; negative = prepaid credit available.

    let stripe_balance_cents: Option<f64> = stripe_json
        .and_then(|v| v.get("customerBalance")?.as_f64())
        .map(|cents| -cents)           // negate: negative balance = positive credit
        .filter(|&v| v > 0.0);

    Ok(CursorUsageData::build(
        included_spend,
        limit_cents,
        auto_pct,
        api_pct,
        total_pct,
        remaining_bonus,
        on_demand_used,
        on_demand_limit,
        is_team,
        stripe_balance_cents,
        plan_name,
        cycle_end,
        email,
    ))
}

// ── Manual token support ──────────────────────────────────────────────────

const CURSOR_MANUAL_TOKEN_KEY: &str = "cursor_manual_token";

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_cursor_auth(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<bool, String> {
    // Check: Cursor app auth token, browser session cookies, or manual token
    Ok(read_cursor_key("cursorAuth/accessToken").is_some()
        || get_cursor_session_cookie().is_some()
        || cache.get_cursor_manual_token().is_some())
}

/// Check only the Cursor desktop app storage (not browsers).
#[tauri::command]
pub fn check_cursor_desktop_auth() -> Result<bool, String> {
    Ok(read_cursor_key("cursorAuth/accessToken").is_some())
}

/// Scan all browsers for cursor.com session cookies.
#[tauri::command]
pub fn pull_cursor_session_from_browsers() -> Result<Vec<BrowserResult>, String> {
    Ok(scan_cursor_browsers())
}

/// Validate a cookie string by hitting the Cursor usage API.
#[tauri::command]
pub async fn test_cursor_connection(cookie: String) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://cursor.com/api/usage-summary")
        .header("Cookie", &cookie)
        .header("Origin", "https://cursor.com")
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("User-Agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Cursor request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Cookie is invalid or expired.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Cursor API returned status {}", response.status()));
    }
    Ok(true)
}

/// Save a manually-entered Cursor access token / cookie to the credential store.
#[tauri::command]
pub fn save_cursor_token(
    app: tauri::AppHandle,
    token: String,
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<(), String> {
    super::credentials::save_to_store(&app, CURSOR_MANUAL_TOKEN_KEY, &token)?;
    cache.set_cursor_manual_token(token);
    Ok(())
}

/// Read the manually-saved Cursor token from the credential store.
#[tauri::command]
pub fn get_cursor_token(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<Option<String>, String> {
    Ok(cache.get_cursor_manual_token())
}

#[tauri::command]
pub fn get_cursor_auth_path() -> String {
    cursor_global_storage_dir()
        .map(|p| {
            let json = p.join("storage.json");
            let db = p.join("state.vscdb");
            if db.exists() {
                db.to_string_lossy().into_owned()
            } else {
                json.to_string_lossy().into_owned()
            }
        })
        .unwrap_or_else(|| "unsupported platform".to_string())
}

#[tauri::command]
pub async fn get_cursor_email() -> Result<Option<String>, String> {
    Ok(read_cursor_key("cursorAuth/cachedEmail"))
}

#[tauri::command]
pub async fn fetch_cursor_usage(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<CursorUsageData, String> {
    fetch_cursor_usage_internal(cache.get_cursor_manual_token()).await
}
