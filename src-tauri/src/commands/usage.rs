use crate::models::{BillingInfo, BundlesInfo, CreditGrant, PeakHoursStatus, PrepaidCredits, UsageData};

#[tauri::command]
pub async fn fetch_usage(session_key: String, org_id: String) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);

    let response = client
        .get(&url)
        .header("cookie", format!("sessionKey={}", session_key))
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

    let usage: UsageData = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse usage data: {}. Raw: {}", e, &text[..text.len().min(500)]))?;

    Ok(usage)
}

#[tauri::command]
pub async fn fetch_usage_raw(session_key: String, org_id: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);

    let response = client
        .get(&url)
        .header("cookie", format!("sessionKey={}", session_key))
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
    let headers = |req: reqwest::RequestBuilder| {
        req.header("cookie", format!("sessionKey={}", session_key))
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

    Ok(BillingInfo {
        prepaid_credits,
        credit_grant,
        bundles,
    })
}

/// Fetch Claude usage via OAuth Bearer token from the Anthropic API.
/// Used when `claude_auth_method == "oauth"` (i.e. Claude Code CLI credentials).
pub(crate) async fn fetch_usage_oauth(access_token: &str) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
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

    serde_json::from_str::<UsageData>(&text).map_err(|e| {
        format!(
            "Failed to parse OAuth usage data: {}. Raw: {}",
            e,
            &text[..text.len().min(500)]
        )
    })
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
