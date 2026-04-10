use std::sync::Mutex;

/// In-memory credential cache.
/// Loaded from tauri-plugin-store on startup, no keychain involved.
pub struct CredentialsCache {
    session_key: Mutex<Option<String>>,
    org_id: Mutex<Option<String>>,
}

impl CredentialsCache {
    pub fn new() -> Self {
        Self {
            session_key: Mutex::new(None),
            org_id: Mutex::new(None),
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
}
