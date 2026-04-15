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

// ── Browser cookie extraction (kept for potential debug use, not surfaced in UI) ──

use crate::models::{BrowserResult, CursorUsageAssembly, CursorUsageData};
use base64::{engine::general_purpose, Engine as _};
use rookie::common::enums::Cookie;
use serde_json::json;

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

/// Scan all browsers for cursor.com session cookies, returning per-browser results.
pub fn scan_cursor_browsers() -> Vec<BrowserResult> {
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

// Protobuf/JSON may encode cents as strings; used by REST + Connect parsers.
fn cursor_json_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        serde_json::Value::String(s) => s.parse::<f64>().ok().filter(|f| f.is_finite()),
        _ => None,
    }
}

fn cursor_get_f64(obj: Option<&serde_json::Value>, key: &str) -> Option<f64> {
    obj?.get(key).and_then(cursor_json_f64)
}

fn decode_jwt_payload(jwt: &str) -> Option<serde_json::Value> {
    let b64 = jwt.split('.').nth(1)?;
    let bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(b64)
        .or_else(|_| {
            let pad = (4 - b64.len() % 4) % 4;
            let mut s = b64.to_string();
            s.push_str(&"=".repeat(pad));
            general_purpose::URL_SAFE.decode(s)
        })
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn jwt_unix_exp(jwt: &str) -> Option<i64> {
    let p = decode_jwt_payload(jwt)?;
    p.get("exp").and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_u64().and_then(|u| i64::try_from(u).ok()))
            .or_else(|| v.as_f64().map(|f| f as i64))
    })
}

/// Cursor session cookie user id: take segment after the last `|` in JWT `sub` when present.
fn cursor_sub_to_user_id(sub: &str) -> &str {
    sub.rsplit('|').next().unwrap_or(sub)
}

/// `WorkosCursorSessionToken=<userId>%3A%3A<access_token>` for `cursor.com` cookie-authenticated routes.
fn synthetic_workos_session_cookie(access_token: &str) -> Option<String> {
    let payload = decode_jwt_payload(access_token)?;
    let sub = payload.get("sub")?.as_str()?;
    let user = cursor_sub_to_user_id(sub);
    if user.is_empty() {
        return None;
    }
    Some(format!(
        "WorkosCursorSessionToken={}%3A%3A{}",
        user, access_token
    ))
}

const CURSOR_OAUTH_CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

async fn cursor_refresh_access_token(
    client: &reqwest::Client,
    refresh_token: &str,
) -> Result<String, String> {
    let resp = client
        .post("https://api2.cursor.sh/oauth/token")
        .header("Content-Type", "application/json")
        .header("User-Agent", crate::USER_AGENT)
        .json(&json!({
            "grant_type": "refresh_token",
            "client_id": CURSOR_OAUTH_CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Cursor token refresh request failed: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Cursor token refresh: invalid JSON ({e})"))?;

    if body.get("shouldLogout").and_then(|v| v.as_bool()) == Some(true) {
        return Err(
            "Cursor refresh token rejected (shouldLogout). Sign in again in the Cursor app."
                .to_string(),
        );
    }

    if !status.is_success() {
        return Err(format!(
            "Cursor token refresh failed: HTTP {} — {}",
            status.as_u16(),
            body
        ));
    }

    let at = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Cursor token refresh returned no access_token.".to_string())?;
    Ok(at.to_string())
}

/// Refresh the access token when it is expired or within two minutes of expiry (if refresh token exists).
async fn resolve_cursor_bearer(client: &reqwest::Client, initial_bearer: String) -> Result<String, String> {
    let Some(rt) = read_cursor_key("cursorAuth/refreshToken").filter(|s| !s.is_empty()) else {
        return Ok(initial_bearer);
    };

    let now = chrono::Utc::now().timestamp();
    let exp = jwt_unix_exp(&initial_bearer);
    let expired = exp.is_some_and(|e| e <= now);
    let expiring_soon = exp.is_some_and(|e| e <= now + 120);

    if !expired && !expiring_soon {
        return Ok(initial_bearer);
    }

    match cursor_refresh_access_token(client, &rt).await {
        Ok(new_at) => Ok(new_at),
        Err(e) if expired => Err(e),
        Err(_) => Ok(initial_bearer),
    }
}

async fn fetch_dashboard_json(
    client: &reqwest::Client,
    method: &str,
    bearer: &str,
) -> (Option<serde_json::Value>, u16) {
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
        Ok(resp) => {
            let code = resp.status().as_u16();
            if resp.status().is_success() {
                (resp.json().await.ok(), code)
            } else {
                (None, code)
            }
        }
        Err(e) => {
            eprintln!("[Cursor] {method}: {e}");
            (None, 0)
        }
    }
}

async fn fetch_cursor_enterprise_usage(
    client: &reqwest::Client,
    cookie: &str,
) -> Option<serde_json::Value> {
    let resp = client
        .get("https://cursor.com/api/usage")
        .header("Cookie", cookie)
        .header("Origin", "https://cursor.com")
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("User-Agent", crate::USER_AGENT)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

type CursorUsageBundle = (
    Option<serde_json::Value>,
    (Option<serde_json::Value>, u16),
    (Option<serde_json::Value>, u16),
    (Option<serde_json::Value>, u16),
    (Option<serde_json::Value>, u16),
    (Option<serde_json::Value>, u16),
    Option<serde_json::Value>,
    Option<serde_json::Value>,
);

async fn cursor_usage_http_bundle(
    client: &reqwest::Client,
    bearer: &str,
    session_cookie: &Option<String>,
) -> CursorUsageBundle {
    let cookie_for_cursor_com = session_cookie
        .clone()
        .or_else(|| synthetic_workos_session_cookie(bearer));
    let cookie_hdr = cookie_for_cursor_com.as_deref();
    tokio::join!(
        fetch_cursor_usage_summary_rest(client, bearer, cookie_hdr),
        fetch_dashboard_json(client, "GetCurrentPeriodUsage", bearer),
        fetch_dashboard_json(client, "GetPlanInfo", bearer),
        fetch_dashboard_json(client, "GetUsageLimitStatusAndActiveGrants", bearer),
        fetch_dashboard_json(client, "GetUsageLimitPolicyStatus", bearer),
        fetch_dashboard_json(client, "GetCreditGrantsBalance", bearer),
        async {
            let Some(cookie) = cookie_hdr else {
                return None;
            };
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
        async {
            let Some(cookie) = cookie_hdr else {
                return None;
            };
            fetch_cursor_enterprise_usage(client, cookie).await
        },
    )
}

/// Dashboard REST (pre–Connect-RPC path): `individualUsage.overall` / `teamUsage.overall`.
fn parse_usage_summary_meter(v: &serde_json::Value) -> Option<(f64, f64)> {
    fn pair(overall: Option<&serde_json::Value>) -> Option<(f64, f64)> {
        let o = overall?;
        let used = cursor_get_f64(Some(o), "used").unwrap_or(0.0);
        let limit = cursor_get_f64(Some(o), "limit").filter(|l| *l > 0.0)?;
        Some((used, limit))
    }
    pair(v.get("individualUsage").and_then(|u| u.get("overall")))
        .or_else(|| pair(v.get("teamUsage").and_then(|u| u.get("overall"))))
}

async fn fetch_cursor_usage_summary_rest(
    client: &reqwest::Client,
    bearer: &str,
    cookie: Option<&str>,
) -> Option<serde_json::Value> {
    let mut req = client
        .get("https://cursor.com/api/usage-summary")
        .header("Origin", "https://cursor.com")
        .header("Referer", "https://cursor.com/dashboard/usage")
        .header("User-Agent", crate::USER_AGENT);
    req = if let Some(c) = cookie {
        req.header("Cookie", c)
    } else {
        req.bearer_auth(bearer)
    };
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Cursor] usage-summary: request error: {e}");
            return None;
        }
    };
    if !resp.status().is_success() {
        eprintln!("[Cursor] usage-summary: HTTP {}", resp.status());
        return None;
    }
    resp.json().await.ok()
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
    // Session cookie from manual entry (cookie string) — not from browser scanning,
    // which triggers macOS keychain prompts on every call.
    let session_cookie: Option<String> = manual_token
        .as_ref()
        .filter(|t| t.contains('=') || t.contains(';'))
        .cloned();

    let bearer_initial: String = session_cookie
        .as_deref()
        .and_then(extract_bearer_from_cookie)
        .or_else(|| {
            manual_token
                .as_ref()
                .filter(|t| !t.contains('=') && !t.contains(';'))
                .cloned()
        })
        .or_else(|| read_cursor_key("cursorAuth/accessToken"))
        .ok_or_else(|| {
            "No Cursor auth found — sign into the Cursor desktop app or enter a token manually.".to_string()
        })?;

    let email = read_cursor_key("cursorAuth/cachedEmail");
    let stored_membership_type = read_cursor_key("cursorAuth/stripeMembershipType");
    let stored_subscription_status = read_cursor_key("cursorAuth/stripeSubscriptionStatus");
    let client = reqwest::Client::new();

    let mut bearer = resolve_cursor_bearer(&client, bearer_initial).await?;

    let mut bundle = cursor_usage_http_bundle(&client, &bearer, &session_cookie).await;
    let (u, st) = &bundle.1;
    if u.is_none() && (*st == 401 || *st == 403) {
        if let Some(rt) = read_cursor_key("cursorAuth/refreshToken").filter(|s| !s.is_empty()) {
            if let Ok(new_b) = cursor_refresh_access_token(&client, &rt).await {
                bearer = new_b;
                bundle = cursor_usage_http_bundle(&client, &bearer, &session_cookie).await;
            }
        }
    }

    let (
        rest_summary,
        (usage_json, _),
        (plan_json, _),
        (grants_status, _),
        (policy_status, _),
        (credit_balance, _),
        stripe_json,
        enterprise_json,
    ) = bundle;

    // ── Parse GetCurrentPeriodUsage ───────────────────────────────────────

    let plan_usage = usage_json.as_ref().and_then(|v| v.get("planUsage"));

    let included_spend = cursor_get_f64(plan_usage, "includedSpend").unwrap_or(0.0);
    let total_spend = cursor_get_f64(plan_usage, "totalSpend").filter(|v| v.is_finite());
    let bonus_spend = cursor_get_f64(plan_usage, "bonusSpend").filter(|v| v.is_finite() && *v > 0.0);
    let bonus_tooltip = plan_usage
        .and_then(|p| p.get("bonusTooltip")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let raw_limit_cents = cursor_get_f64(plan_usage, "limit").filter(|v| v.is_finite() && *v > 0.0);
    let plan_remaining_cents = cursor_get_f64(plan_usage, "remaining").filter(|v| v.is_finite());
    let total_pct = cursor_get_f64(plan_usage, "totalPercentUsed").filter(|v| v.is_finite());
    let auto_pct = cursor_get_f64(plan_usage, "autoPercentUsed").filter(|v| v.is_finite());
    let api_pct = cursor_get_f64(plan_usage, "apiPercentUsed").filter(|v| v.is_finite());
    let remaining_bonus = plan_usage
        .and_then(|p| p.get("remainingBonus")?.as_bool())
        .unwrap_or(false);
    let display_message = usage_json
        .as_ref()
        .and_then(|v| v.get("displayMessage")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let usage_meter_enabled = usage_json
        .as_ref()
        .and_then(|v| v.get("enabled")?.as_bool());
    let display_threshold_bp =
        cursor_get_f64(usage_json.as_ref(), "displayThreshold").filter(|v| v.is_finite());
    let auto_model_selected_display_message = usage_json
        .as_ref()
        .and_then(|v| v.get("autoModelSelectedDisplayMessage")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let named_model_selected_display_message = usage_json
        .as_ref()
        .and_then(|v| v.get("namedModelSelectedDisplayMessage")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let spend_limit = usage_json.as_ref().and_then(|v| v.get("spendLimitUsage"));
    let on_demand_used = cursor_get_f64(spend_limit, "individualUsed").filter(|v| v.is_finite());
    let on_demand_limit = cursor_get_f64(spend_limit, "individualLimit").filter(|v| v.is_finite() && *v > 0.0);
    let on_demand_remaining = cursor_get_f64(spend_limit, "individualRemaining").filter(|v| v.is_finite());
    let on_demand_pooled_used = cursor_get_f64(spend_limit, "pooledUsed").filter(|v| v.is_finite());
    let on_demand_pooled_limit = cursor_get_f64(spend_limit, "pooledLimit").filter(|v| v.is_finite() && *v > 0.0);
    let on_demand_pooled_remaining = cursor_get_f64(spend_limit, "pooledRemaining").filter(|v| v.is_finite());
    let on_demand_limit_type = spend_limit
        .and_then(|s| s.get("limitType")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    // ── Parse GetPlanInfo ─────────────────────────────────────────────────

    let plan_info = plan_json.as_ref().and_then(|v| v.get("planInfo"));
    let mut plan_name: Option<String> = plan_info
        .and_then(|p| p.get("planName")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let plan_price: Option<String> = plan_info
        .and_then(|p| p.get("price")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let plan_included_amount_cents =
        cursor_get_f64(plan_info, "includedAmountCents").filter(|v| v.is_finite() && *v > 0.0);

    if plan_name.is_none() {
        plan_name = rest_summary
            .as_ref()
            .and_then(|v| v.get("membershipType")?.as_str())
            .map(|s| s.to_string());
    }

    let mut limit_cents = raw_limit_cents
        .or(plan_included_amount_cents)
        .or(on_demand_limit)
        .or(on_demand_pooled_limit)
        .unwrap_or(0.0);

    let mut spend_for_meter = included_spend;
    if spend_for_meter <= f64::EPSILON {
        if let Some(t) = total_spend.filter(|t| *t > f64::EPSILON) {
            spend_for_meter = t;
        }
    }
    if spend_for_meter <= f64::EPSILON {
        if let Some(u) = on_demand_used.filter(|u| *u > f64::EPSILON) {
            spend_for_meter = u;
        } else if let Some(u) = on_demand_pooled_used.filter(|u| *u > f64::EPSILON) {
            spend_for_meter = u;
        }
    }

    // Prefer dashboard REST meter when it returns a positive cap (matches cursor.com/usage for most accounts).
    if let Some((used, lim)) = rest_summary.as_ref().and_then(parse_usage_summary_meter) {
        if lim > f64::EPSILON {
            limit_cents = lim;
            spend_for_meter = used.max(0.0);
        }
    }

    let is_team = plan_name.as_deref() == Some("Team")
        || on_demand_limit_type.as_deref() == Some("team")
        || on_demand_pooled_limit.is_some();

    fn parse_cursor_ms(value: Option<&serde_json::Value>) -> Option<String> {
        value
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i64>().ok())
            .and_then(|ms| chrono::DateTime::from_timestamp(ms / 1000, 0))
            .map(|dt| dt.to_rfc3339())
    }

    let billing_cycle_start =
        parse_cursor_ms(usage_json.as_ref().and_then(|v| v.get("billingCycleStart")));

    // billingCycleEnd: Connect uses epoch ms string; usage-summary often uses an ISO timestamp.
    let cycle_end = parse_cursor_ms(usage_json.as_ref().and_then(|v| v.get("billingCycleEnd")))
        .or_else(|| parse_cursor_ms(plan_info.and_then(|p| p.get("billingCycleEnd"))))
        .or_else(|| {
            rest_summary
                .as_ref()
                .and_then(|v| v.get("billingCycleEnd")?.as_str())
                .map(|s| s.to_string())
        });

    // ── Parse Stripe balance ──────────────────────────────────────────────
    // customerBalance is in cents; negative = prepaid credit available.

    let membership_type: Option<String> = stripe_json
        .as_ref()
        .and_then(|v| v.get("membershipType")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or(stored_membership_type)
        .or_else(|| {
            rest_summary
                .as_ref()
                .and_then(|v| v.get("membershipType")?.as_str())
                .map(|s| s.to_string())
        });
    let subscription_status: Option<String> = stripe_json
        .as_ref()
        .and_then(|v| v.get("subscriptionStatus")?.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or(stored_subscription_status);
    let stripe_balance_cents: Option<f64> = stripe_json
        .as_ref()
        .and_then(|v| v.get("customerBalance").and_then(cursor_json_f64))
        .map(|cents| -cents) // negate: negative balance = positive credit
        .filter(|&v| v > 0.0);

    let mut extras_map = serde_json::Map::new();
    if let Some(v) = grants_status {
        extras_map.insert(
            "GetUsageLimitStatusAndActiveGrants".to_string(),
            v,
        );
    }
    if let Some(v) = policy_status {
        extras_map.insert("GetUsageLimitPolicyStatus".to_string(), v);
    }
    if let Some(v) = credit_balance {
        extras_map.insert("GetCreditGrantsBalance".to_string(), v);
    }
    let connect_extras = if extras_map.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(extras_map))
    };

    let enterprise_usage = enterprise_json.filter(|v| !v.is_null());

    Ok(CursorUsageData::from_assembly(CursorUsageAssembly {
        plan_name,
        plan_price,
        plan_included_amount_cents,
        spend_cents: spend_for_meter,
        plan_remaining_cents,
        total_spend_cents: total_spend,
        bonus_spend_cents: bonus_spend,
        limit_cents,
        auto_pct,
        api_pct,
        total_pct,
        remaining_bonus,
        bonus_tooltip,
        display_message,
        on_demand_used_cents: on_demand_used,
        on_demand_limit_cents: on_demand_limit,
        on_demand_remaining_cents: on_demand_remaining,
        on_demand_pooled_used_cents: on_demand_pooled_used,
        on_demand_pooled_limit_cents: on_demand_pooled_limit,
        on_demand_pooled_remaining_cents: on_demand_pooled_remaining,
        on_demand_limit_type,
        is_team,
        membership_type,
        subscription_status,
        stripe_balance_cents,
        cycle_end,
        billing_cycle_start,
        email,
        usage_meter_enabled,
        display_threshold_bp,
        auto_model_selected_display_message,
        named_model_selected_display_message,
        connect_extras,
        enterprise_usage,
    }))
}

// ── Manual token support ──────────────────────────────────────────────────

const CURSOR_MANUAL_TOKEN_KEY: &str = "cursor_manual_token";

fn debug_scalar_preview(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) => {
            if s.len() > 72 {
                json!(format!("{}… (len={})", &s[..72], s.len()))
            } else {
                json!(s)
            }
        }
        serde_json::Value::Number(n) => json!(n),
        serde_json::Value::Bool(b) => json!(b),
        serde_json::Value::Null => json!(null),
        _ => json!(
            v.to_string()
                .chars()
                .take(72)
                .collect::<String>()
        ),
    }
}

/// HTTP + JSON shape for one Connect RPC (no bearer token in output).
async fn inspect_cursor_dashboard_rpc(
    client: &reqwest::Client,
    method: &str,
    bearer: &str,
) -> serde_json::Value {
    let url = format!("https://api2.cursor.sh/aiserver.v1.DashboardService/{method}");
    let resp = match client
        .post(&url)
        .bearer_auth(bearer)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("User-Agent", crate::USER_AGENT)
        .body("{}")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "method": method,
                "transport_error": e.to_string(),
            });
        }
    };
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    let parsed: Option<serde_json::Value> = serde_json::from_str(&text).ok();
    let mut out = json!({
        "method": method,
        "http_status": status,
        "body_len": text.len(),
    });
    let Some(p) = parsed else {
        if !text.is_empty() {
            let prefix: String = text.chars().take(400).collect();
            out["non_json_body_prefix"] = json!(prefix);
        }
        return out;
    };
    let Some(_) = p.as_object() else {
        out["json_note"] = json!("response root is not an object");
        return out;
    };
    let mut keys: Vec<_> = p.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    out["top_level_keys"] = json!(keys);
    if let Some(pu) = p.get("planUsage").and_then(|x| x.as_object()) {
        let mut k: Vec<_> = pu.keys().cloned().collect();
        k.sort();
        out["plan_usage_keys"] = json!(k);
        let mut samples = serde_json::Map::new();
        for key in &k {
            if let Some(val) = pu.get(key) {
                samples.insert(key.clone(), debug_scalar_preview(val));
            }
        }
        out["plan_usage_values"] = json!(samples);
    }
    if let Some(su) = p.get("spendLimitUsage").and_then(|x| x.as_object()) {
        let mut k: Vec<_> = su.keys().cloned().collect();
        k.sort();
        out["spend_limit_usage_keys"] = json!(k);
        let mut samples = serde_json::Map::new();
        for key in &k {
            if let Some(val) = su.get(key) {
                samples.insert(key.clone(), debug_scalar_preview(val));
            }
        }
        out["spend_limit_usage_values"] = json!(samples);
    }
    if method == "GetAggregatedUsageEvents" {
        if let Some(n) = p.get("aggregations").and_then(|x| x.as_array()).map(|a| a.len()) {
            out["aggregations_count"] = json!(n);
        }
        if let Some(tc) = p.get("totalCostCents") {
            out["totalCostCents"] = debug_scalar_preview(tc);
        }
    }
    if method == "GetPlanInfo" {
        if let Some(pi) = p.get("planInfo").and_then(|x| x.as_object()) {
            let mut k: Vec<_> = pi.keys().cloned().collect();
            k.sort();
            out["plan_info_keys"] = json!(k);
        }
    }
    out
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Diagnostics for Cursor dashboard APIs (no secrets). Compare with [OpenUsage Cursor provider](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md).
#[tauri::command]
pub async fn debug_cursor_api(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<String, String> {
    let manual = cache.get_cursor_manual_token();
    let session_cookie: Option<String> = manual
        .as_ref()
        .filter(|t| t.contains('=') || t.contains(';'))
        .cloned();

    let bearer_initial: String = session_cookie
        .as_deref()
        .and_then(extract_bearer_from_cookie)
        .or_else(|| {
            manual
                .as_ref()
                .filter(|t| !t.contains('=') && !t.contains(';'))
                .cloned()
        })
        .or_else(|| read_cursor_key("cursorAuth/accessToken"))
        .ok_or_else(|| {
            "No Cursor auth found — sign into the Cursor app or add a manual token/cookie in Settings."
                .to_string()
        })?;

    let client = reqwest::Client::new();
    let bearer = resolve_cursor_bearer(&client, bearer_initial).await?;

    let cookie_for_cursor_com = session_cookie
        .clone()
        .or_else(|| synthetic_workos_session_cookie(&bearer));
    let cursor_com_cookie = cookie_for_cursor_com.as_deref();

    let cursor_com_cookie_mode = if session_cookie.is_some() {
        "manual_cookie"
    } else if cursor_com_cookie.is_some() {
        "synthetic_workos"
    } else {
        "none"
    };

    let auth_source = if session_cookie.is_some() {
        "manual_cookie"
    } else if manual
        .as_ref()
        .is_some_and(|t| !t.contains('=') && !t.contains(';'))
    {
        "manual_bearer"
    } else {
        "desktop_global_storage"
    };

    let (
        usage,
        plan,
        aggregated,
        hard_limit,
        limit_policy,
        grants_active,
        credit_balance,
        stripe_probe,
        enterprise_probe,
    ) = tokio::join!(
        inspect_cursor_dashboard_rpc(&client, "GetCurrentPeriodUsage", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetPlanInfo", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetAggregatedUsageEvents", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetHardLimit", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetUsageLimitPolicyStatus", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetUsageLimitStatusAndActiveGrants", &bearer),
        inspect_cursor_dashboard_rpc(&client, "GetCreditGrantsBalance", &bearer),
        async {
            let Some(cookie) = cursor_com_cookie else {
                return json!({ "ok": false, "note": "no cursor.com session cookie" });
            };
            match client
                .get("https://cursor.com/api/auth/stripe")
                .header("Cookie", cookie)
                .header("User-Agent", crate::USER_AGENT)
                .send()
                .await
            {
                Ok(resp) => {
                    let ok = resp.status().is_success();
                    let st = resp.status().as_u16();
                    let txt = resp.text().await.unwrap_or_default();
                    let keys = serde_json::from_str::<serde_json::Value>(&txt)
                        .ok()
                        .and_then(|v| v.as_object().map(|o| {
                            let mut k: Vec<_> = o.keys().cloned().collect();
                            k.sort();
                            k
                        }));
                    json!({ "ok": ok, "http_status": st, "body_len": txt.len(), "top_level_keys": keys })
                }
                Err(e) => json!({ "ok": false, "transport_error": e.to_string() }),
            }
        },
        async {
            let Some(cookie) = cursor_com_cookie else {
                return json!({ "ok": false, "note": "no cursor.com session cookie" });
            };
            match fetch_cursor_enterprise_usage(&client, cookie).await {
                Some(v) => {
                    let keys = v.as_object().map(|o| {
                        let mut k: Vec<_> = o.keys().cloned().collect();
                        k.sort();
                        k
                    });
                    json!({ "ok": true, "top_level_keys": keys })
                }
                None => json!({ "ok": false, "note": "GET /api/usage failed or empty" }),
            }
        },
    );

    let rest_profile = match client
        .get("https://api2.cursor.sh/auth/full_stripe_profile")
        .bearer_auth(&bearer)
        .header("User-Agent", crate::USER_AGENT)
        .send()
        .await
    {
        Ok(r) => {
            let st = r.status().as_u16();
            let txt = r.text().await.unwrap_or_default();
            let keys = serde_json::from_str::<serde_json::Value>(&txt)
                .ok()
                .and_then(|v| v.as_object().map(|o| {
                    let mut k: Vec<_> = o.keys().cloned().collect();
                    k.sort();
                    k
                }));
            json!({
                "http_status": st,
                "body_len": txt.len(),
                "top_level_keys": keys,
            })
        }
        Err(e) => json!({ "transport_error": e.to_string() }),
    };

    let usage_summary = match fetch_cursor_usage_summary_rest(
        &client,
        &bearer,
        cursor_com_cookie,
    )
    .await
    {
        Some(v) => {
            let keys = v.as_object().map(|o| {
                let mut k: Vec<_> = o.keys().cloned().collect();
                k.sort();
                k
            });
            let meter = parse_usage_summary_meter(&v).map(|(used, lim)| {
                json!({ "used_cents": used, "limit_cents": lim })
            });
            json!({
                "ok": true,
                "auth": if cursor_com_cookie.is_some() { "cookie" } else { "bearer" },
                "top_level_keys": keys,
                "parsed_overall_meter": meter,
            })
        }
        None => json!({
            "ok": false,
            "note": "usage-summary request failed or returned non-success (UsageWatch uses this for Enterprise spend vs Connect RPC).",
        }),
    };

    let out = json!({
        "auth_source": auth_source,
        "cursor_com_cookie_mode": cursor_com_cookie_mode,
        "email_from_desktop_storage": read_cursor_key("cursorAuth/cachedEmail"),
        "global_storage_dir": cursor_global_storage_dir().map(|p| p.to_string_lossy().into_owned()),
        "connect_rpc": [usage, plan, aggregated, hard_limit, limit_policy, grants_active, credit_balance],
        "restGET_api2_auth_full_stripe_profile": rest_profile,
        "restGET_cursor_com_api_usage_summary": usage_summary,
        "restGET_cursor_com_api_auth_stripe": stripe_probe,
        "restGET_cursor_com_api_usage_enterprise": enterprise_probe,
        "openusage_reference": "https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md",
    });

    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_cursor_auth(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<bool, String> {
    Ok(read_cursor_key("cursorAuth/accessToken").is_some()
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
