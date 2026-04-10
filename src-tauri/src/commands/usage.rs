use crate::models::UsageData;

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

    let usage: UsageData = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse usage data: {}", e))?;

    Ok(usage)
}
