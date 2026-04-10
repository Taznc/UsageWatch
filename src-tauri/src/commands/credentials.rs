use keyring::Entry;
use crate::models::Organization;

const SERVICE: &str = "claude-usage-tracker";
const USER_SESSION_KEY: &str = "session-key";
const USER_ORG_ID: &str = "org-id";

fn get_entry(user: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, user).map_err(|e| format!("Keyring error: {}", e))
}

#[tauri::command]
pub fn save_session_key(key: String) -> Result<(), String> {
    let entry = get_entry(USER_SESSION_KEY)?;
    entry
        .set_password(&key)
        .map_err(|e| format!("Failed to save session key: {}", e))
}

#[tauri::command]
pub fn get_session_key() -> Result<Option<String>, String> {
    let entry = get_entry(USER_SESSION_KEY)?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get session key: {}", e)),
    }
}

#[tauri::command]
pub fn delete_session_key() -> Result<(), String> {
    let entry = get_entry(USER_SESSION_KEY)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete session key: {}", e)),
    }
}

#[tauri::command]
pub fn save_org_id(org_id: String) -> Result<(), String> {
    let entry = get_entry(USER_ORG_ID)?;
    entry
        .set_password(&org_id)
        .map_err(|e| format!("Failed to save org ID: {}", e))
}

#[tauri::command]
pub fn get_org_id() -> Result<Option<String>, String> {
    let entry = get_entry(USER_ORG_ID)?;
    match entry.get_password() {
        Ok(id) => Ok(Some(id)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get org ID: {}", e)),
    }
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
