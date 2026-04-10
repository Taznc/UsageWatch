use std::sync::Arc;
use crate::credentials_cache::CredentialsCache;
use crate::models::Organization;

#[tauri::command]
pub fn save_session_key(key: String, cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<(), String> {
    cache.set_session_key(key);
    Ok(())
}

#[tauri::command]
pub fn get_session_key(cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<Option<String>, String> {
    Ok(cache.get_session_key())
}

#[tauri::command]
pub fn delete_session_key(cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<(), String> {
    cache.delete_session_key();
    Ok(())
}

#[tauri::command]
pub fn save_org_id(org_id: String, cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<(), String> {
    cache.set_org_id(org_id);
    Ok(())
}

#[tauri::command]
pub fn get_org_id(cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<Option<String>, String> {
    Ok(cache.get_org_id())
}

#[tauri::command]
pub async fn test_connection(session_key: String) -> Result<Vec<Organization>, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://claude.ai/api/organizations")
        .header("cookie", format!("sessionKey={}", session_key))
        .header("content-type", "application/json")
        .header("user-agent", "Claude Usage Tracker/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "API returned status {}: Invalid session key or expired session",
            response.status()
        ));
    }

    let orgs: Vec<Organization> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse organization list: {}", e))?;

    Ok(orgs)
}
