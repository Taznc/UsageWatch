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

// ── API fetch ─────────────────────────────────────────────────────────────

use crate::models::CursorUsageData;

/// Try to extract cursor.com session cookies from installed browsers.
/// Returns cookie header string if found.
fn get_cursor_session_cookie() -> Option<String> {
    use rookie::common::enums::Cookie;

    type BrowserFn = fn(Option<Vec<String>>) -> rookie::Result<Vec<Cookie>>;

    let domains = Some(vec!["cursor.com".to_string()]);

    let browsers: Vec<(&str, BrowserFn)> = vec![
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
    ];

    for (_name, fetch_fn) in browsers {
        match fetch_fn(domains.clone()) {
            Ok(cookies) if !cookies.is_empty() => {
                // Build full cookie header from all cursor.com cookies
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

pub(crate) async fn fetch_cursor_usage_internal() -> Result<CursorUsageData, String> {
    let cookie = get_cursor_session_cookie()
        .ok_or_else(|| "No cursor.com session found — log into cursor.com/dashboard in your browser".to_string())?;

    let email = read_cursor_key("cursorAuth/cachedEmail");

    let client = reqwest::Client::new();
    let origin = "https://cursor.com";

    // Fire API calls in parallel — use cookie auth + Origin header
    let (usage_res, hard_limit_res, billing_res, plan_res) = tokio::join!(
        client
            .get("https://cursor.com/api/usage-summary")
            .header("Cookie", &cookie)
            .header("Origin", origin)
            .header("Referer", "https://cursor.com/dashboard/usage")
            .header("User-Agent", crate::USER_AGENT)
            .send(),
        client
            .post("https://cursor.com/api/dashboard/get-hard-limit")
            .header("Cookie", &cookie)
            .header("Origin", origin)
            .header("Referer", "https://cursor.com/dashboard/usage")
            .header("Content-Type", "application/json")
            .header("User-Agent", crate::USER_AGENT)
            .body("{}")
            .send(),
        client
            .post("https://cursor.com/api/dashboard/get-monthly-billing-cycle")
            .header("Cookie", &cookie)
            .header("Origin", origin)
            .header("Referer", "https://cursor.com/dashboard/usage")
            .header("Content-Type", "application/json")
            .header("User-Agent", crate::USER_AGENT)
            .body("{}")
            .send(),
        client
            .post("https://cursor.com/api/dashboard/get-plan-info")
            .header("Cookie", &cookie)
            .header("Origin", origin)
            .header("Referer", "https://cursor.com/dashboard/usage")
            .header("Content-Type", "application/json")
            .header("User-Agent", crate::USER_AGENT)
            .body("{}")
            .send(),
    );

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

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_cursor_auth() -> Result<bool, String> {
    // Check both: Cursor app auth token OR browser session cookies
    Ok(read_cursor_key("cursorAuth/accessToken").is_some() || get_cursor_session_cookie().is_some())
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
pub async fn fetch_cursor_usage() -> Result<CursorUsageData, String> {
    fetch_cursor_usage_internal().await
}
