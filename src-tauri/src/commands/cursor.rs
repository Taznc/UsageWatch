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

enum CursorAuth {
    Cookie(String),
    Bearer(String),
}

fn classify_manual_cursor_auth(value: String) -> CursorAuth {
    if value.contains('=') || value.contains(';') {
        CursorAuth::Cookie(value)
    } else {
        CursorAuth::Bearer(value)
    }
}

// ── API fetch ─────────────────────────────────────────────────────────────

pub(crate) async fn fetch_cursor_usage_internal(manual_token: Option<String>) -> Result<CursorUsageData, String> {
    let auth = if let Some(cookie) = get_cursor_session_cookie() {
        CursorAuth::Cookie(cookie)
    } else if let Some(token) = manual_token {
        classify_manual_cursor_auth(token)
    } else if let Some(token) = read_cursor_key("cursorAuth/accessToken") {
        CursorAuth::Bearer(token)
    } else {
        return Err("No Cursor auth found — sign into the Cursor desktop app, log into cursor.com/dashboard in your browser, or enter a token manually.".to_string());
    };

    let email = read_cursor_key("cursorAuth/cachedEmail");

    let client = reqwest::Client::new();
    let origin = "https://cursor.com";

    let usage_req = client
        .get("https://cursor.com/api/usage-summary")
        .header("Origin", origin)
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("User-Agent", crate::USER_AGENT);
    let hard_limit_req = client
        .post("https://cursor.com/api/dashboard/get-hard-limit")
        .header("Origin", origin)
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("Content-Type", "application/json")
        .header("User-Agent", crate::USER_AGENT)
        .body("{}");
    let billing_req = client
        .post("https://cursor.com/api/dashboard/get-monthly-billing-cycle")
        .header("Origin", origin)
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("Content-Type", "application/json")
        .header("User-Agent", crate::USER_AGENT)
        .body("{}");
    let plan_req = client
        .post("https://cursor.com/api/dashboard/get-plan-info")
        .header("Origin", origin)
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("Content-Type", "application/json")
        .header("User-Agent", crate::USER_AGENT)
        .body("{}");

    // Fire API calls in parallel using whichever auth source is available.
    let (usage_res, hard_limit_res, billing_res, plan_res) = match &auth {
        CursorAuth::Cookie(cookie) => tokio::join!(
            usage_req.try_clone().ok_or_else(|| "Failed to clone Cursor usage request".to_string())?.header("Cookie", cookie).send(),
            hard_limit_req.try_clone().ok_or_else(|| "Failed to clone Cursor hard-limit request".to_string())?.header("Cookie", cookie).send(),
            billing_req.try_clone().ok_or_else(|| "Failed to clone Cursor billing request".to_string())?.header("Cookie", cookie).send(),
            plan_req.try_clone().ok_or_else(|| "Failed to clone Cursor plan request".to_string())?.header("Cookie", cookie).send(),
        ),
        CursorAuth::Bearer(token) => tokio::join!(
            usage_req.try_clone().ok_or_else(|| "Failed to clone Cursor usage request".to_string())?.bearer_auth(token).send(),
            hard_limit_req.try_clone().ok_or_else(|| "Failed to clone Cursor hard-limit request".to_string())?.bearer_auth(token).send(),
            billing_req.try_clone().ok_or_else(|| "Failed to clone Cursor billing request".to_string())?.bearer_auth(token).send(),
            plan_req.try_clone().ok_or_else(|| "Failed to clone Cursor plan request".to_string())?.bearer_auth(token).send(),
        ),
    };

    // Helper: parse a response as JSON Value with debug logging
    async fn parse_json(
        label: &str,
        res: Result<reqwest::Response, reqwest::Error>,
    ) -> Option<serde_json::Value> {
        match res {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    eprintln!("[Cursor] {label}: HTTP {status} — {}", &body[..body.len().min(200)]);
                    return None;
                }
                let text = resp.text().await.ok()?;
                serde_json::from_str(&text).ok()
            }
            Err(e) => {
                eprintln!("[Cursor] {label}: request error: {e}");
                None
            }
        }
    }

    // Parse responses
    let raw_usage = parse_json("usage-summary", usage_res).await;
    let _hard_limit_json = parse_json("hard-limit", hard_limit_res).await;
    let billing_json = parse_json("billing-cycle", billing_res).await;
    let plan_json = parse_json("plan-info", plan_res).await;

    // Primary data source: usage-summary has individualUsage.overall.{used, limit}
    let (spend_cents, hard_limit_cents) = raw_usage.as_ref()
        .and_then(|v| {
            let overall = v.get("individualUsage")?.get("overall")?;
            let used = overall.get("used")?.as_f64()?;
            let limit = overall.get("limit")?.as_f64()?;
            Some((used, limit))
        })
        .unwrap_or((0.0, 0.0));

    // Billing cycle end — prefer usage-summary's billingCycleEnd (ISO string),
    // fall back to billing-cycle endpoint (epoch millis)
    let cycle_end: Option<String> = raw_usage.as_ref()
        .and_then(|v| v.get("billingCycleEnd")?.as_str().map(|s| s.to_string()))
        .or_else(|| {
            billing_json.and_then(|v| {
                let ms = v.get("endDateEpochMillis")?.as_str()?.parse::<i64>().ok()?;
                chrono::DateTime::from_timestamp(ms / 1000, 0)
                    .map(|dt| dt.to_rfc3339())
            })
        });

    // Plan name from plan-info endpoint
    let plan_name: Option<String> = plan_json
        .and_then(|v| {
            v.get("planInfo")?.get("planName")?.as_str().map(|s| s.to_string())
        })
        // Fall back to usage-summary's membershipType
        .or_else(|| {
            raw_usage.as_ref()
                .and_then(|v| v.get("membershipType")?.as_str().map(|s| s.to_string()))
        });

    Ok(CursorUsageData::build(
        spend_cents,
        hard_limit_cents,
        plan_name,
        cycle_end,
        email,
        raw_usage,
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
