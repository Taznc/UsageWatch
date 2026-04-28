use crate::models::{
    BillingInfo, BundlesInfo, CreditGrant, PeakHoursStatus, PrepaidCredits, UsageData,
};

pub(crate) fn claude_cookie_header(session_key_or_cookie: &str) -> String {
    let trimmed = session_key_or_cookie.trim();
    if trimmed.contains('=') || trimmed.contains(';') {
        trimmed.to_string()
    } else {
        format!("sessionKey={trimmed}")
    }
}

fn summarize_usage_windows(value: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for key in [
        "five_hour",
        "seven_day",
        "seven_day_opus",
        "seven_day_sonnet",
        "seven_day_oauth_apps",
        "seven_day_cowork",
        "seven_day_omelette",
        "omelette_promotional",
    ] {
        let Some(window) = value.get(key) else {
            out.insert(key.to_string(), serde_json::json!({ "present": false }));
            continue;
        };
        out.insert(
            key.to_string(),
            serde_json::json!({
                "present": !window.is_null(),
                "utilization": window.get("utilization"),
                "resets_at": window.get("resets_at"),
            }),
        );
    }
    out.insert(
        "first_reset_like_value".to_string(),
        serde_json::json!(extract_reset_datetime(value)),
    );
    serde_json::Value::Object(out)
}

fn top_level_keys(value: &serde_json::Value) -> Vec<String> {
    let mut keys = value
        .as_object()
        .map(|o| o.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    keys.sort();
    keys
}

#[tauri::command]
pub async fn fetch_usage(session_key: String, org_id: String) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);
    let cookie = claude_cookie_header(&session_key);

    let response = client
        .get(&url)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .header("user-agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Session key expired or invalid. Please update your session key.".into());
    }

    if !response.status().is_success() {
        return Err(format!("API returned status {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let mut usage: UsageData = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse usage data: {}. Raw: {}", e, &text[..text.len().min(500)]))?;
    usage.normalize_aliases();

    Ok(usage)
}

#[tauri::command]
pub async fn fetch_usage_raw(session_key: String, org_id: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);
    let cookie = claude_cookie_header(&session_key);

    let response = client
        .get(&url)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .header("user-agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

#[tauri::command]
pub async fn fetch_billing(session_key: String, org_id: String) -> Result<BillingInfo, String> {
    let client = reqwest::Client::new();
    let cookie = claude_cookie_header(&session_key);
    let headers = |req: reqwest::RequestBuilder| {
        req.header("cookie", cookie.clone())
            .header("content-type", "application/json")
            .header("user-agent", crate::USER_AGENT)
    };

    // Fetch prepaid credits
    let credits_url = format!(
        "https://claude.ai/api/organizations/{}/prepaid/credits",
        org_id
    );
    let prepaid_credits = match headers(client.get(&credits_url)).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<PrepaidCredits>().await.ok(),
        _ => None,
    };

    // Fetch credit grant
    let grant_url = format!(
        "https://claude.ai/api/organizations/{}/overage_credit_grant",
        org_id
    );
    let credit_grant = match headers(client.get(&grant_url)).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<CreditGrant>().await.ok(),
        _ => None,
    };

    // Fetch bundles (for reset date)
    let bundles_url = format!(
        "https://claude.ai/api/organizations/{}/prepaid/bundles",
        org_id
    );
    let bundles = match headers(client.get(&bundles_url)).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<BundlesInfo>().await.ok(),
        _ => None,
    };

    let overage_url = format!(
        "https://claude.ai/api/organizations/{}/overage_spend_limit",
        org_id
    );
    let overage_reset_at = match headers(client.get(&overage_url)).send().await {
        Ok(resp) if resp.status().is_success() => resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|json| extract_reset_datetime(&json)),
        _ => None,
    };

    let bundles = merge_bundle_reset(bundles, overage_reset_at);

    Ok(BillingInfo {
        prepaid_credits,
        credit_grant,
        bundles,
    })
}

#[tauri::command]
pub async fn debug_claude_api(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<String, String> {
    debug_claude_api_impl(cache.inner(), false).await
}

#[tauri::command]
pub async fn debug_claude_api_raw(
    cache: tauri::State<'_, std::sync::Arc<crate::credentials_cache::CredentialsCache>>,
) -> Result<String, String> {
    debug_claude_api_impl(cache.inner(), true).await
}

async fn debug_claude_api_impl(
    cache: &std::sync::Arc<crate::credentials_cache::CredentialsCache>,
    include_raw: bool,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let session_key = cache.get_session_key();
    let org_id = cache.get_org_id();
    let auth_method = cache.get_claude_auth_method();

    let mut out = serde_json::json!({
        "stored_auth_method": auth_method,
        "has_web_cookie_or_session_key": session_key.is_some(),
        "stored_value_is_cookie_header": session_key.as_ref().is_some_and(|s| s.contains('=') || s.contains(';')),
        "has_org_id": org_id.is_some(),
        "org_id": org_id,
        "oauth_usage": null,
        "web_usage": null,
        "billing": null,
        "interpretation": null,
    });

    out["oauth_usage"] = match crate::commands::claude_oauth::get_claude_oauth_token().await {
        Ok(token) => {
            let resp = client
                .get("https://api.anthropic.com/api/oauth/usage")
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("anthropic-beta", "oauth-2025-04-20")
                .header("user-agent", crate::USER_AGENT)
                .send()
                .await
                .map_err(|e| format!("OAuth usage request failed: {e}"))?;
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(json) => serde_json::json!({
                    "http_status": status,
                    "top_level_keys": top_level_keys(&json),
                    "windows": summarize_usage_windows(&json),
                    "raw_body": if include_raw { Some(json) } else { None },
                }),
                Err(_) => serde_json::json!({
                    "http_status": status,
                    "non_json_body_len": text.len(),
                    "raw_body": if include_raw { Some(serde_json::Value::String(text)) } else { None },
                }),
            }
        }
        Err(e) => serde_json::json!({ "error": e }),
    };

    if let (Some(session_key), Some(org_id)) = (session_key, cache.get_org_id()) {
        let cookie = claude_cookie_header(&session_key);
        let usage_url = format!("https://claude.ai/api/organizations/{org_id}/usage");
        let resp = client
            .get(&usage_url)
            .header("cookie", &cookie)
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .header("user-agent", crate::USER_AGENT)
            .send()
            .await
            .map_err(|e| format!("Web usage request failed: {e}"))?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        out["web_usage"] = match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(json) => serde_json::json!({
                "http_status": status,
                "top_level_keys": top_level_keys(&json),
                "windows": summarize_usage_windows(&json),
                "raw_body": if include_raw { Some(json) } else { None },
            }),
            Err(_) => serde_json::json!({
                "http_status": status,
                "non_json_body_len": text.len(),
                "raw_body": if include_raw { Some(serde_json::Value::String(text)) } else { None },
            }),
        };

        let mut billing = serde_json::Map::new();
        for (name, path) in [
            ("prepaid_bundles", "prepaid/bundles"),
            ("overage_spend_limit", "overage_spend_limit"),
            ("prepaid_credits", "prepaid/credits"),
            ("overage_credit_grant", "overage_credit_grant"),
        ] {
            let url = format!("https://claude.ai/api/organizations/{org_id}/{path}");
            let resp = client
                .get(&url)
                .header("cookie", &cookie)
                .header("accept", "application/json")
                .header("content-type", "application/json")
                .header("user-agent", crate::USER_AGENT)
                .send()
                .await
                .map_err(|e| format!("{name} request failed: {e}"))?;
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let summary = match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(json) => serde_json::json!({
                    "http_status": status,
                    "top_level_keys": top_level_keys(&json),
                    "first_reset_like_value": extract_reset_datetime(&json),
                    "raw_body": if include_raw { Some(json) } else { None },
                }),
                Err(_) => serde_json::json!({
                    "http_status": status,
                    "non_json_body_len": text.len(),
                    "raw_body": if include_raw { Some(serde_json::Value::String(text)) } else { None },
                }),
            };
            billing.insert(name.to_string(), summary);
        }
        out["billing"] = serde_json::Value::Object(billing);
    }

    let web_reset = out
        .pointer("/web_usage/windows/first_reset_like_value")
        .and_then(|v| v.as_str());
    let oauth_reset = out
        .pointer("/oauth_usage/windows/first_reset_like_value")
        .and_then(|v| v.as_str());
    let billing_reset = out
        .get("billing")
        .and_then(|v| v.as_object())
        .and_then(|billing| {
            billing
                .values()
                .find_map(|v| v.get("first_reset_like_value").and_then(|r| r.as_str()))
        });
    out["interpretation"] = if web_reset.or(oauth_reset).or(billing_reset).is_some() {
        serde_json::json!("At least one Claude source returned a reset-like timestamp.")
    } else {
        serde_json::json!("No checked Claude source returned a reset timestamp. On Enterprise, Claude may only expose a reset time after a hard limit is reached.")
    };

    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

fn merge_bundle_reset(
    bundles: Option<BundlesInfo>,
    reset_at: Option<String>,
) -> Option<BundlesInfo> {
    match (bundles, reset_at) {
        (Some(mut bundles), Some(reset_at)) if bundles.purchases_reset_at.is_none() => {
            bundles.purchases_reset_at = Some(reset_at);
            Some(bundles)
        }
        (Some(bundles), _) => Some(bundles),
        (None, Some(reset_at)) => Some(BundlesInfo {
            purchases_reset_at: Some(reset_at),
            bundle_paid_this_month_minor_units: 0.0,
            bundle_monthly_cap_minor_units: 0.0,
        }),
        (None, None) => None,
    }
}

fn extract_reset_datetime(value: &serde_json::Value) -> Option<String> {
    const RESET_KEYS: &[&str] = &[
        "purchases_reset_at",
        "reset_at",
        "resets_at",
        "next_reset_at",
        "next_billing_at",
        "billing_cycle_end",
        "billingCycleEnd",
        "current_period_end",
        "currentPeriodEnd",
        "period_end",
        "periodEnd",
        "renews_at",
        "renewsAt",
    ];

    fn normalize(value: &serde_json::Value) -> Option<String> {
        match value {
            serde_json::Value::String(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return None;
                }
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
                    return Some(dt.to_rfc3339());
                }
                trimmed
                    .parse::<i64>()
                    .ok()
                    .and_then(normalize_unix_timestamp)
                    .or_else(|| Some(trimmed.to_string()))
            }
            serde_json::Value::Number(n) => n
                .as_i64()
                .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok()))
                .or_else(|| n.as_f64().map(|f| f as i64))
                .and_then(normalize_unix_timestamp),
            _ => None,
        }
    }

    fn walk(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
        match value {
            serde_json::Value::Object(map) => {
                for key in keys {
                    if let Some(found) = map.get(*key).and_then(normalize) {
                        return Some(found);
                    }
                }
                map.values().find_map(|child| walk(child, keys))
            }
            serde_json::Value::Array(values) => values.iter().find_map(|child| walk(child, keys)),
            _ => None,
        }
    }

    walk(value, RESET_KEYS)
}

fn normalize_unix_timestamp(value: i64) -> Option<String> {
    let dt = if value > 10_000_000_000 {
        chrono::DateTime::from_timestamp_millis(value)
    } else {
        chrono::DateTime::from_timestamp(value, 0)
    }?;
    Some(dt.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_overage_reset_from_nested_json() {
        let value = json!({
            "spend": {
                "limit": 11000,
                "billingCycleEnd": "2026-05-01T00:00:00.000Z"
            }
        });

        assert_eq!(
            extract_reset_datetime(&value).as_deref(),
            Some("2026-05-01T00:00:00+00:00")
        );
    }

    #[test]
    fn extracts_overage_reset_from_unix_millis() {
        let value = json!({ "current_period_end": 1777593600000_i64 });

        assert_eq!(
            extract_reset_datetime(&value).as_deref(),
            Some("2026-05-01T00:00:00+00:00")
        );
    }
}

/// Fetch Claude usage via OAuth Bearer token from the Anthropic API.
/// Used when `claude_auth_method == "oauth"` (i.e. Claude Code CLI credentials).
pub(crate) async fn fetch_usage_oauth(access_token: &str) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("user-agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("OAuth usage request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Claude OAuth token rejected. Re-run 'claude' to log in again.".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "OAuth usage API returned {}: {}",
            status,
            &body[..body.len().min(300)]
        ));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read OAuth usage response: {}", e))?;

    let mut usage = serde_json::from_str::<UsageData>(&text).map_err(|e| {
        format!(
            "Failed to parse OAuth usage data: {}. Raw: {}",
            e,
            &text[..text.len().min(500)]
        )
    })?;
    usage.normalize_aliases();
    Ok(usage)
}

/// Fetch peak/off-peak status from PromoClock's public API.
/// Returns None on any error — this is always supplemental and never blocks usage display.
pub(crate) async fn fetch_peak_hours() -> Option<PeakHoursStatus> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PromoClockResponse {
        #[serde(default)]
        is_peak: bool,
        #[serde(default)]
        is_off_peak: bool,
        #[serde(default)]
        is_weekend: bool,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://promoclock.co/api/status")
        .header("user-agent", crate::USER_AGENT)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let data: PromoClockResponse = resp.json().await.ok()?;
    Some(PeakHoursStatus {
        is_peak: data.is_peak,
        is_off_peak: data.is_off_peak,
        is_weekend: data.is_weekend,
    })
}
