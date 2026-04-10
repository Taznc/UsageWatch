use crate::models::{BillingInfo, CreditGrant, PrepaidCredits, UsageData};

#[tauri::command]
pub async fn fetch_usage(session_key: String, org_id: String) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);

    let response = client
        .get(&url)
        .header("cookie", format!("sessionKey={}", session_key))
        .header("content-type", "application/json")
        .header("user-agent", "Claude Usage Tracker/0.1.0")
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
        .header("user-agent", "Claude Usage Tracker/0.1.0")
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
            .header("user-agent", "Claude Usage Tracker/0.1.0")
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

    Ok(BillingInfo {
        prepaid_credits,
        credit_grant,
    })
}

#[tauri::command]
pub async fn fetch_status() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://status.anthropic.com/api/v2/status.json")
        .header("user-agent", "Claude Usage Tracker/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Status fetch failed: {}", e))?;

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse status: {}", e))
}
