use std::path::PathBuf;

// ── Auth path resolution ───────────────────────────────────────────────────
//
// Cursor is built on VS Code / Electron and stores credentials in the VS Code
// globalStorage format. The file contains flat dot-separated keys:
//   "cursorAuth/accessToken"   — Bearer token for Cursor API calls
//   "cursorAuth/cachedEmail"   — The signed-in user's email
//   "cursorAuth/stripePricingTable" — subscription tier info
//
// Paths by platform:
//   macOS:   ~/Library/Application Support/Cursor/User/globalStorage/storage.json
//   Windows: %APPDATA%\Cursor\User\globalStorage\storage.json
//   Linux:   ~/.config/Cursor/User/globalStorage/storage.json

fn cursor_storage_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support/Cursor/User/globalStorage/storage.json"),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("Cursor/User/globalStorage/storage.json"),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config/Cursor/User/globalStorage/storage.json"),
        )
    }
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Returns true if Cursor's globalStorage file exists and contains a valid
/// access token. Used by the settings UI to show connection status.
#[tauri::command]
pub async fn check_cursor_auth() -> Result<bool, String> {
    let Some(path) = cursor_storage_path() else {
        return Ok(false);
    };

    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };

    // The token key is a flat string key, not nested
    let has_token = json
        .get("cursorAuth/accessToken")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    Ok(has_token)
}

/// Returns the platform-specific path that UsageWatch checks for Cursor credentials.
/// The UI calls this to display the correct path to the user without needing
/// JS-side platform detection.
#[tauri::command]
pub fn get_cursor_auth_path() -> String {
    cursor_storage_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unsupported platform".to_string())
}

/// Returns the cached email from Cursor's globalStorage, if present.
/// Useful for showing who is logged in without making a network request.
#[tauri::command]
pub async fn get_cursor_email() -> Result<Option<String>, String> {
    let Some(path) = cursor_storage_path() else {
        return Ok(None);
    };

    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let email = json
        .get("cursorAuth/cachedEmail")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    Ok(email)
}
