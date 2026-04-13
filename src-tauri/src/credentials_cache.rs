use std::sync::Mutex;

/// In-memory credential cache.
/// Loaded from tauri-plugin-store on startup, no keychain involved.
pub struct CredentialsCache {
    session_key: Mutex<Option<String>>,
    org_id: Mutex<Option<String>>,
    codex_manual_token: Mutex<Option<String>>,
    codex_browser_cookie: Mutex<Option<String>>,
    cursor_manual_token: Mutex<Option<String>>,
}

impl CredentialsCache {
    pub fn new() -> Self {
        Self {
            session_key: Mutex::new(None),
            org_id: Mutex::new(None),
            codex_manual_token: Mutex::new(None),
            codex_browser_cookie: Mutex::new(None),
            cursor_manual_token: Mutex::new(None),
        }
    }

    pub fn get_session_key(&self) -> Option<String> {
        self.session_key.lock().unwrap().clone()
    }

    pub fn get_org_id(&self) -> Option<String> {
        self.org_id.lock().unwrap().clone()
    }

    pub fn set_session_key(&self, key: String) {
        *self.session_key.lock().unwrap() = Some(key);
    }

    pub fn set_org_id(&self, id: String) {
        *self.org_id.lock().unwrap() = Some(id);
    }

    pub fn clear_session_key(&self) {
        *self.session_key.lock().unwrap() = None;
    }

    pub fn get_codex_manual_token(&self) -> Option<String> {
        self.codex_manual_token.lock().unwrap().clone()
    }

    pub fn set_codex_manual_token(&self, token: String) {
        *self.codex_manual_token.lock().unwrap() = Some(token);
    }

    pub fn get_codex_browser_cookie(&self) -> Option<String> {
        self.codex_browser_cookie.lock().unwrap().clone()
    }

    pub fn set_codex_browser_cookie(&self, cookie: String) {
        *self.codex_browser_cookie.lock().unwrap() = Some(cookie);
    }

    pub fn get_cursor_manual_token(&self) -> Option<String> {
        self.cursor_manual_token.lock().unwrap().clone()
    }

    pub fn set_cursor_manual_token(&self, token: String) {
        *self.cursor_manual_token.lock().unwrap() = Some(token);
    }
}
