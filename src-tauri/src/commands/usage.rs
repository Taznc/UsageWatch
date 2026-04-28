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
