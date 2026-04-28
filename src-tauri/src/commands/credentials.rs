use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use crate::credentials_cache::CredentialsCache;
use crate::models::Organization;

pub(crate) fn save_to_store(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let store = app
        .store("credentials.json")
        .map_err(|e| format!("Store error: {}", e))?;
    store.set(key, serde_json::json!(value));
    store.save().map_err(|e| format!("Store save error: {}", e))
}


fn delete_from_store(app: &AppHandle, key: &str) -> Result<(), String> {
    let store = app
        .store("credentials.json")
        .map_err(|e| format!("Store error: {}", e))?;
    let _ = store.delete(key);
    store.save().map_err(|e| format!("Store save error: {}", e))
}

/// Called once at startup to load credentials from the store file into memory
pub fn load_credentials_from_store(app: &AppHandle, cache: &CredentialsCache) {
    match app.store("credentials.json") {
        Ok(store) => {
            if let Some(val) = store.get("session_key") {
                if let Some(s) = val.as_str() {
                    cache.set_session_key(s.to_string());
                }
            }
            if let Some(val) = store.get("org_id") {
                if let Some(s) = val.as_str() {
                    cache.set_org_id(s.to_string());
                }
            }
            if let Some(val) = store.get("codex_manual_token") {
                if let Some(s) = val.as_str() {
                    cache.set_codex_manual_token(s.to_string());
                }
            }
            if let Some(val) = store.get("codex_browser_cookie") {
                if let Some(s) = val.as_str() {
                    cache.set_codex_browser_cookie(s.to_string());
                }
            }
            if let Some(val) = store.get("cursor_manual_token") {
                if let Some(s) = val.as_str() {
                    cache.set_cursor_manual_token(s.to_string());
                }
            }
            if let Some(val) = store.get("claude_auth_method") {
                if let Some(s) = val.as_str() {
                    cache.set_claude_auth_method(s.to_string());
                }
            }
        }
        Err(e) => {
            eprintln!("[credentials] failed to open store: {}", e);
        }
    }
}

#[tauri::command]
pub fn save_session_key(
    app: AppHandle,
    key: String,
    cache: tauri::State<'_, Arc<CredentialsCache>>,
) -> Result<(), String> {
    save_to_store(&app, "session_key", &key)?;
    cache.set_session_key(key);
    Ok(())
}

#[tauri::command]
pub fn get_session_key(cache: tauri::State<'_, Arc<CredentialsCache>>) -> Result<Option<String>, String> {
    Ok(cache.get_session_key())
}

#[tauri::command]
pub fn delete_session_key(
    app: AppHandle,
    cache: tauri::State<'_, Arc<CredentialsCache>>,
) -> Result<(), String> {
    delete_from_store(&app, "session_key")?;
    cache.clear_session_key();
    Ok(())
}

#[tauri::command]
pub fn save_org_id(
    app: AppHandle,
    org_id: String,
    cache: tauri::State<'_, Arc<CredentialsCache>>,
) -> Result<(), String> {
    save_to_store(&app, "org_id", &org_id)?;
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
    let cookie = crate::commands::usage::claude_cookie_header(&session_key);
    let response = client
        .get("https://claude.ai/api/organizations")
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .header("user-agent", crate::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "API returned status {}: {}\nResponse: {}",
            status,
            if status.as_u16() == 403 { "Forbidden" } else { "Error" },
            if body.len() > 500 { format!("{}...", &body[..500]) } else { body },
        ));
    }

    let orgs: Vec<Organization> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse organization list: {}", e))?;

    Ok(orgs)
}
