use std::sync::Mutex;

/// In-memory credential cache to avoid repeated keychain prompts.
/// Credentials are loaded from keychain once, then served from memory.
pub struct CredentialsCache {
    session_key: Mutex<Option<String>>,
    org_id: Mutex<Option<String>>,
    loaded: Mutex<bool>,
}

impl CredentialsCache {
    pub fn new() -> Self {
        Self {
            session_key: Mutex::new(None),
            org_id: Mutex::new(None),
            loaded: Mutex::new(false),
        }
    }

    /// Load credentials from keychain into memory (called once at startup)
    pub fn load_from_keychain(&self) {
        let mut loaded = self.loaded.lock().unwrap();
        if *loaded {
            return;
        }

        if let Ok(entry) = keyring::Entry::new("claude-usage-tracker", "session-key") {
            if let Ok(key) = entry.get_password() {
                *self.session_key.lock().unwrap() = Some(key);
            }
        }

        if let Ok(entry) = keyring::Entry::new("claude-usage-tracker", "org-id") {
            if let Ok(id) = entry.get_password() {
                *self.org_id.lock().unwrap() = Some(id);
            }
        }

        *loaded = true;
    }

    pub fn get_session_key(&self) -> Option<String> {
        self.session_key.lock().unwrap().clone()
    }

    pub fn get_org_id(&self) -> Option<String> {
        self.org_id.lock().unwrap().clone()
    }

    pub fn set_session_key(&self, key: String) {
        // Write to keychain
        if let Ok(entry) = keyring::Entry::new("claude-usage-tracker", "session-key") {
            let _ = entry.set_password(&key);
        }
        // Update cache
        *self.session_key.lock().unwrap() = Some(key);
    }

    pub fn set_org_id(&self, id: String) {
        // Write to keychain
        if let Ok(entry) = keyring::Entry::new("claude-usage-tracker", "org-id") {
            let _ = entry.set_password(&id);
        }
        // Update cache
        *self.org_id.lock().unwrap() = Some(id);
    }

    pub fn delete_session_key(&self) {
        if let Ok(entry) = keyring::Entry::new("claude-usage-tracker", "session-key") {
            let _ = entry.delete_credential();
        }
        *self.session_key.lock().unwrap() = None;
    }

    pub fn has_credentials(&self) -> bool {
        self.session_key.lock().unwrap().is_some() && self.org_id.lock().unwrap().is_some()
    }
}
