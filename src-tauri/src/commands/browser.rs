use rookie::common::enums::Cookie;
use crate::models::{BrowserResult, ClaudeInstanceResult};

type BrowserFn = fn(Option<Vec<String>>) -> rookie::Result<Vec<Cookie>>;

/// Shown when Chrome's app-bound (v20) cookie encryption blocks decryption.
const CHROME_V20_MSG: &str = "Chrome uses app-bound encryption (v20) for these cookies, which cannot be decrypted by external apps. Use Firefox/Zen, Claude Desktop, or manual entry.";

/// Copy a file that may be held open by another process.
/// Uses OpenOptionsExt::share_mode which sets FILE_SHARE_READ|WRITE|DELETE,
/// allowing reads even when another process holds the file open.
#[cfg(target_os = "windows")]
fn copy_shared(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    use std::io::Read;
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_SHARE_READ=1, FILE_SHARE_WRITE=2, FILE_SHARE_DELETE=4
    const SHARE_ALL: u32 = 0x00000001 | 0x00000002 | 0x00000004;
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .open(src)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    std::fs::write(dst, &buf)
}

/// Decrypt a DPAPI-protected blob using Win32 CryptUnprotectData.
/// Used to recover the AES-256 key stored in an Electron profile's `Local State`.
#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Option<Vec<u8>> {
    #[repr(C)]
    struct DataBlob { cb: u32, pb: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptUnprotectData(
            p_in: *const DataBlob, descr: *mut *mut u16, entropy: *const DataBlob,
            reserved: *mut core::ffi::c_void, prompt: *const core::ffi::c_void,
            flags: u32, p_out: *mut DataBlob,
        ) -> i32;
    }
    extern "system" { fn LocalFree(h: *mut core::ffi::c_void) -> *mut core::ffi::c_void; }
    let input = DataBlob { cb: data.len() as u32, pb: data.as_ptr() as *mut u8 };
    let mut output = DataBlob { cb: 0, pb: std::ptr::null_mut() };
    unsafe {
        let ok = CryptUnprotectData(
            &input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(),
            std::ptr::null(), 0, &mut output,
        );
        if ok != 0 && !output.pb.is_null() {
            let bytes = std::slice::from_raw_parts(output.pb, output.cb as usize).to_vec();
            LocalFree(output.pb as *mut _);
            Some(bytes)
        } else {
            None
        }
    }
}

/// Manual fallback for Electron cookie decryption when rookie fails.
/// Reads the AES-256 key from `Local State` (DPAPI-encrypted), then decrypts
/// v10/v11 cookie values with AES-256-GCM using rusqlite for the DB query.
/// Used for per-instance profiles in `~/.claude-instances/*`.
#[cfg(target_os = "windows")]
fn read_instance_cookies_manual_windows(
    local_state_path: &std::path::Path,
    cookies_path: &std::path::Path,
) -> Result<Option<String>, String> {
    use base64::engine::{Engine, general_purpose::STANDARD as B64};
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};

    // 1. Extract AES key from Local State
    let ls = std::fs::read_to_string(local_state_path)
        .map_err(|e| format!("Cannot read Local State: {e}"))?;
    let val: serde_json::Value = serde_json::from_str(&ls)
        .map_err(|e| format!("Cannot parse Local State: {e}"))?;
    let enc_b64 = val["os_crypt"]["encrypted_key"].as_str()
        .ok_or("No os_crypt.encrypted_key in Local State")?;
    let enc_bytes = B64.decode(enc_b64).map_err(|e| format!("Base64 error: {e}"))?;
    if enc_bytes.get(..5) != Some(b"DPAPI") {
        return Err("Unexpected Local State key format (no DPAPI prefix)".to_string());
    }
    let aes_key = dpapi_decrypt(&enc_bytes[5..])
        .ok_or("DPAPI decryption of cookie key failed")?;
    if aes_key.len() != 32 {
        return Err(format!("AES key wrong length: {} (expected 32)", aes_key.len()));
    }

    // 2. Copy cookie DB to temp path
    let tmp = std::env::temp_dir().join("usagewatch_manual_inst_cookies.db");
    copy_shared(cookies_path, &tmp).map_err(|e| {
        if e.raw_os_error() == Some(32) {
            "Cookie database is locked — Claude Desktop appears to be running. Close it and rescan.".to_string()
        } else {
            format!("Cannot copy cookie DB: {e}")
        }
    })?;

    // 3. Open DB, query claude.ai cookies, decrypt each v10/v11 value
    let cookie_pairs: Option<Vec<(String, String)>> = (|| {
        let conn = rusqlite::Connection::open_with_flags(
            &tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).ok()?;
        let mut stmt = conn.prepare(
            "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai'",
        ).ok()?;
        let raw: Vec<(String, Vec<u8>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()?.flatten().collect();

        let cipher = Aes256Gcm::new_from_slice(&aes_key).ok()?;
        let mut out = Vec::new();
        for (name, enc_val) in raw {
            if enc_val.len() > 15
                && (enc_val.starts_with(b"v10") || enc_val.starts_with(b"v11"))
            {
                let nonce = aes_gcm::aead::generic_array::GenericArray::from_slice(&enc_val[3..15]);
                if let Ok(plain) = cipher.decrypt(nonce, &enc_val[15..]) {
                    if let Ok(s) = String::from_utf8(plain) {
                        out.push((name, s));
                    }
                }
            }
        }
        Some(out)
    })();
    let _ = std::fs::remove_file(&tmp);

    let pairs = cookie_pairs.unwrap_or_default();
    if !pairs.iter().any(|(n, _)| n == "sessionKey") {
        return Ok(None);
    }
    let header = pairs.iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
    Ok(if header.is_empty() { None } else { Some(header) })
}

/// Read a named cookie from a Chromium-based Electron app's SQLite cookie DB.
/// Copies the DB to a temp file first (handles file locking from running Electron apps),
/// then uses rookie's chromium_based() which handles DPAPI + AES-GCM decryption correctly.
#[cfg(target_os = "windows")]
fn read_electron_cookie_windows(
    local_state_path: &std::path::Path,
    cookies_path: &std::path::Path,
    cookie_name: &str,
    domains: Option<Vec<String>>,
) -> Option<String> {
    let tmp = std::env::temp_dir().join("usagewatch_electron_cookies_tmp.db");
    copy_shared(cookies_path, &tmp).ok()?;

    let result = rookie::chromium_based(
        local_state_path.to_path_buf(),
        tmp.clone(),
        domains,
    );
    let _ = std::fs::remove_file(&tmp);

    result.ok()?.into_iter().find(|c| c.name == cookie_name).map(|c| c.value)
}

/// Reads the full claude.ai cookie header from an Electron app's cookie DB.
/// Returns `Ok(Some(header))` on success, `Ok(None)` if decryption worked but no
/// sessionKey was present, and `Err(msg)` with a user-facing reason if the DB was
/// locked (Claude Desktop running) or decryption failed.
#[cfg(target_os = "windows")]
fn read_electron_cookie_header_windows(
    local_state_path: &std::path::Path,
    cookies_path: &std::path::Path,
    domains: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let tmp = std::env::temp_dir().join("usagewatch_electron_cookies_tmp.db");
    let copy_err = copy_shared(cookies_path, &tmp).err();

    let result = if copy_err.is_none() {
        let r = rookie::chromium_based(local_state_path.to_path_buf(), tmp.clone(), domains.clone());
        let _ = std::fs::remove_file(&tmp);
        r
    } else {
        // Copy failed (often a sharing violation while the app holds the DB open).
        // Try a direct read as a fallback — rookie can sometimes still open it.
        rookie::chromium_based(local_state_path.to_path_buf(), cookies_path.to_path_buf(), domains)
    };

    match result {
        Ok(cookies) => Ok(claude_cookie_header_from_cookies(&cookies)),
        Err(e) => {
            // ERROR_SHARING_VIOLATION (os error 32) on the copy means the DB is
            // exclusively locked by a running Electron app.
            if copy_err.as_ref().and_then(|e| e.raw_os_error()) == Some(32) {
                Err("Cookie database is locked — Claude Desktop appears to be running. Close it and rescan.".to_string())
            } else if e.to_string().contains("decrypt_encrypted_value") {
                // Rookie failed decrypting a specific cookie (e.g. mixed key versions).
                // Fall back to manual DPAPI + AES-256-GCM decryption.
                read_instance_cookies_manual_windows(local_state_path, cookies_path)
            } else {
                Err(format!("Cookie decryption failed: {e}"))
            }
        }
    }
}

/// Loose account metadata parsed from a Claude Code `.claude.json` `oauthAccount`.
#[derive(Default)]
struct ClaudeAccountMeta {
    email: Option<String>,
    display_name: Option<String>,
    org_id: Option<String>,
    org_name: Option<String>,
}

fn read_claude_account_meta(claude_json_path: &std::path::Path) -> ClaudeAccountMeta {
    let mut meta = ClaudeAccountMeta::default();
    let Ok(content) = std::fs::read_to_string(claude_json_path) else { return meta; };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) else { return meta; };
    if let Some(acct) = val.get("oauthAccount") {
        let s = |k: &str| acct.get(k).and_then(|v| v.as_str()).map(String::from);
        meta.email = s("emailAddress");
        meta.display_name = s("displayName");
        meta.org_id = s("organizationUuid");
        meta.org_name = s("organizationName");
    }
    meta
}

/// Detects whether Chrome's claude.ai cookies use app-bound (v20) encryption,
/// which rookie cannot decrypt. The encrypted_value prefix "v20" == x'763230'.
#[cfg(target_os = "windows")]
fn chrome_has_v20_claude_cookies() -> bool {
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return false; };
    let db = std::path::PathBuf::from(local)
        .join("Google").join("Chrome").join("User Data")
        .join("Default").join("Network").join("Cookies");
    if !db.exists() {
        return false;
    }
    let tmp = std::env::temp_dir().join("usagewatch_chrome_v20_check.db");
    if copy_shared(&db, &tmp).is_err() {
        return false;
    }
    let count: i64 = (|| {
        let conn = rusqlite::Connection::open_with_flags(
            &tmp,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).ok()?;
        conn.query_row(
            "SELECT count(*) FROM cookies WHERE host_key LIKE '%claude.ai' AND substr(encrypted_value,1,3) = x'763230'",
            [],
            |row| row.get(0),
        ).ok()
    })().unwrap_or(0);
    let _ = std::fs::remove_file(&tmp);
    count > 0
}

#[cfg(not(target_os = "windows"))]
fn chrome_has_v20_claude_cookies() -> bool {
    false
}

fn claude_cookie_header_from_cookies(cookies: &[Cookie]) -> Option<String> {
    if !cookies.iter().any(|c| c.name == "sessionKey") {
        return None;
    }

    let header = cookies
        .iter()
        .filter(|c| !c.name.is_empty() && !c.value.is_empty())
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ");

    if header.is_empty() {
        None
    } else {
        Some(header)
    }
}

/// Detailed diagnostic for Claude Desktop cookie detection on Windows.
/// Returns a list of log lines explaining each step.
#[cfg(debug_assertions)]
#[tauri::command]
#[cfg(target_os = "windows")]
pub fn debug_claude_desktop_cookies() -> Vec<String> {
    let mut log = Vec::<String>::new();

    let claude_dir = match std::env::var("APPDATA") {
        Ok(p) => std::path::PathBuf::from(p).join("Claude"),
        Err(e) => { log.push(format!("❌ APPDATA not set: {e}")); return log; }
    };
    log.push(format!("📁 Claude dir: {}", claude_dir.display()));
    log.push(format!("   exists: {}", claude_dir.exists()));

    let key_path = claude_dir.join("Local State");
    log.push(format!("🔑 Local State: {}", key_path.display()));
    log.push(format!("   exists: {}", key_path.exists()));

    let candidates = [
        claude_dir.join("Network").join("Cookies"),
        claude_dir.join("Default").join("Cookies"),
        claude_dir.join("Cookies"),
    ];
    for p in &candidates {
        log.push(format!("🍪 Candidate: {} — exists: {}", p.display(), p.exists()));
    }

    let cookies_path = match candidates.iter().find(|p| p.exists()) {
        Some(p) => p.clone(),
        None => { log.push("❌ No Cookies file found in any candidate path".to_string()); return log; }
    };
    log.push(format!("✅ Using: {}", cookies_path.display()));

    // Copy to temp file first to handle file locking
    let tmp = std::env::temp_dir().join("usagewatch_debug_cookies_tmp.db");
    log.push(format!("📋 Copying to temp: {}", tmp.display()));
    let read_path = match copy_shared(&cookies_path, &tmp) {
        Ok(()) => {
            log.push("✅ Copy succeeded".to_string());
            tmp.clone()
        }
        Err(e) => {
            log.push(format!("❌ Copy failed: {e}"));
            log.push("ℹ️  Trying direct read fallback while Claude Desktop is running...".to_string());
            cookies_path.clone()
        }
    };

    // Use rookie's chromium_based which handles DPAPI + AES-GCM correctly
    log.push("🔑 Running rookie::chromium_based decryption...".to_string());
    match rookie::chromium_based(key_path, read_path, Some(vec!["claude.ai".to_string()])) {
        Ok(cookies) => {
            log.push(format!("✅ Decrypted {} cookies for claude.ai", cookies.len()));
            for c in &cookies {
                log.push(format!("   name={:?} domain={} len={}", c.name, c.domain, c.value.len()));
            }
            if let Some(s) = cookies.iter().find(|c| c.name == "sessionKey") {
                log.push(format!("✅ sessionKey found! len={}", s.value.len()));
                if let Some(header) = claude_cookie_header_from_cookies(&cookies) {
                    log.push(format!("✅ full Cookie header built; len={}", header.len()));
                }
            } else {
                log.push("❌ sessionKey not in decrypted cookies".to_string());
            }
        }
        Err(e) => {
            log.push(format!("❌ rookie::chromium_based failed: {e}"));
        }
    }

    let _ = std::fs::remove_file(&tmp);
    log
}

#[cfg(debug_assertions)]
#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub fn debug_claude_desktop_cookies() -> Vec<String> {
    vec!["Debug only available on Windows".to_string()]
}

/// Scan all Claude Desktop instances (the main `%APPDATA%\Claude` profile plus every
/// per-instance profile under `~/.claude-instances/<name>`) for a claude.ai session,
/// pairing each with account metadata from its `claude-config/.claude.json`.
#[cfg(target_os = "windows")]
fn scan_claude_instances_inner() -> Vec<ClaudeInstanceResult> {
    let mut candidates: Vec<(String, std::path::PathBuf, Option<std::path::PathBuf>)> = Vec::new();

    // Main %APPDATA%\Claude profile; metadata falls back to %USERPROFILE%\.claude.json.
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("Claude");
        if dir.exists() {
            let meta = std::env::var("USERPROFILE").ok()
                .map(|p| std::path::PathBuf::from(p).join(".claude.json"));
            candidates.push(("main".to_string(), dir, meta));
        }
    }

    // Per-instance Electron profiles under %USERPROFILE%\.claude-instances\<name>\
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let instances_dir = std::path::PathBuf::from(userprofile).join(".claude-instances");
        if let Ok(entries) = std::fs::read_dir(&instances_dir) {
            for entry in entries.flatten() {
                let dir = entry.path();
                // Must look like an Electron profile (has a Local State key store).
                if !dir.is_dir() || !dir.join("Local State").exists() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                let meta = dir.join("claude-config").join(".claude.json");
                candidates.push((name, dir, Some(meta)));
            }
        }
    }

    let mut results = Vec::new();
    for (instance, dir, meta_path) in candidates {
        let meta = meta_path.as_deref().map(read_claude_account_meta).unwrap_or_default();
        let key_path = dir.join("Local State");
        let cookie_candidates = [
            dir.join("Network").join("Cookies"),  // Modern Electron layout
            dir.join("Default").join("Cookies"),  // Chromium profile layout
            dir.join("Cookies"),                   // Flat/legacy layout
        ];

        let mut session_key = None;
        let mut error = None;
        let mut tried_any = false;
        for cookies_path in &cookie_candidates {
            if !cookies_path.exists() || !key_path.exists() {
                continue;
            }
            tried_any = true;
            match read_electron_cookie_header_windows(&key_path, cookies_path, Some(vec!["claude.ai".to_string()])) {
                Ok(Some(header)) => { session_key = Some(header); error = None; break; }
                Ok(None) => {}
                Err(e) => { error = Some(e); break; }
            }
        }
        if session_key.is_none() && error.is_none() {
            error = Some(if tried_any {
                "No Claude session cookie found — this profile may not be logged in.".to_string()
            } else {
                "No cookie database found for this profile.".to_string()
            });
        }

        let label = if instance == "main" { "Claude Desktop".to_string() } else { instance.clone() };
        results.push(ClaudeInstanceResult {
            instance, label,
            email: meta.email, display_name: meta.display_name,
            org_id: meta.org_id, org_name: meta.org_name,
            session_key, error,
        });
    }
    results
}

#[cfg(target_os = "macos")]
fn scan_claude_instances_inner() -> Vec<ClaudeInstanceResult> {
    let home = std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    let mut candidates: Vec<(String, std::path::PathBuf, Option<std::path::PathBuf>)> = Vec::new();

    let main_dir = home.join("Library/Application Support/Claude");
    if main_dir.exists() {
        candidates.push(("main".to_string(), main_dir, Some(home.join(".claude.json"))));
    }
    if let Ok(entries) = std::fs::read_dir(home.join(".claude-instances")) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = dir.join("claude-config").join(".claude.json");
            candidates.push((name, dir, Some(meta)));
        }
    }

    let config = rookie::config::Browser {
        paths: vec![],
        channels: None,
        unix_crypt_name: None,
        osx_key_service: Some("Claude Safe Storage".to_string()),
        osx_key_user: Some("Claude".to_string()),
    };

    let mut results = Vec::new();
    for (instance, dir, meta_path) in candidates {
        let meta = meta_path.as_deref().map(read_claude_account_meta).unwrap_or_default();
        let cookie_candidates = [dir.join("Network").join("Cookies"), dir.join("Cookies")];

        let mut session_key = None;
        let mut error = None;
        for cookies_path in &cookie_candidates {
            if !cookies_path.exists() {
                continue;
            }
            match rookie::chromium_based(&config, cookies_path.clone(), Some(vec!["claude.ai".to_string()])) {
                Ok(cookies) => {
                    if let Some(header) = claude_cookie_header_from_cookies(&cookies) {
                        session_key = Some(header);
                        error = None;
                        break;
                    }
                }
                Err(e) => { error = Some(format!("Cookie decryption failed: {e}")); }
            }
        }
        if session_key.is_none() && error.is_none() {
            error = Some("No Claude session cookie found — this profile may not be logged in.".to_string());
        }

        let label = if instance == "main" { "Claude Desktop".to_string() } else { instance.clone() };
        results.push(ClaudeInstanceResult {
            instance, label,
            email: meta.email, display_name: meta.display_name,
            org_id: meta.org_id, org_name: meta.org_name,
            session_key, error,
        });
    }
    results
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn scan_claude_instances_inner() -> Vec<ClaudeInstanceResult> {
    Vec::new()
}

/// Tauri command wrapper around [`scan_claude_instances_inner`].
#[tauri::command]
pub fn scan_claude_instances() -> Vec<ClaudeInstanceResult> {
    scan_claude_instances_inner()
}

#[tauri::command]
pub fn pull_session_from_browsers() -> Result<Vec<BrowserResult>, String> {
    let domains = Some(vec!["claude.ai".to_string()]);
    let mut results = Vec::new();

    let browsers: Vec<(&str, BrowserFn)> = vec![
        ("Chrome", rookie::chrome),
        ("Firefox", rookie::firefox),
        ("Zen", rookie::zen),
        ("Arc", rookie::arc),
        ("Brave", rookie::brave),
        ("Edge", rookie::edge),
        ("Vivaldi", rookie::vivaldi),
        ("Opera", rookie::opera),
        ("Chromium", rookie::chromium),
        #[cfg(target_os = "macos")]
        ("Safari", rookie::safari),
    ];

    for (name, fetch_fn) in browsers {
        match fetch_fn(domains.clone()) {
            Ok(cookies) => {
                // Collect ALL sessionKey cookies — there may be multiple for different
                // domains/paths and we need the right one.
                let session_cookies: Vec<&Cookie> = cookies
                    .iter()
                    .filter(|c| c.name == "sessionKey")
                    .collect();

                let debug_parts: Vec<String> = session_cookies
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        format!(
                            "  [{}] domain={}, path={}, len={}",
                            i, c.domain, c.path, c.value.len(),
                        )
                    })
                    .collect();

                let debug = if !session_cookies.is_empty() {
                    Some(format!(
                        "total_cookies={}, sessionKey_count={}\n{}",
                        cookies.len(),
                        session_cookies.len(),
                        debug_parts.join("\n"),
                    ))
                } else if !cookies.is_empty() {
                    let cookie_names: Vec<&str> = cookies.iter().map(|c| c.name.as_str()).collect();
                    Some(format!(
                        "total_cookies={}, no sessionKey found, names={:?}",
                        cookies.len(),
                        cookie_names,
                    ))
                } else {
                    None
                };

                let session_key = claude_cookie_header_from_cookies(&cookies);

                // If Chrome has claude.ai cookies but none are readable, explain v20.
                let error = if session_key.is_none() && name == "Chrome" && chrome_has_v20_claude_cookies() {
                    Some(CHROME_V20_MSG.to_string())
                } else {
                    None
                };

                if session_key.is_some() || debug.is_some() || error.is_some() {
                    results.push(BrowserResult {
                        browser: name.to_string(),
                        session_key,
                        debug,
                        error,
                    });
                }
            }
            Err(e) => {
                eprintln!("[browser-scan] {}: error: {:?}", name, e);
                // Chrome erroring on claude.ai cookies is usually app-bound encryption.
                if name == "Chrome" && chrome_has_v20_claude_cookies() {
                    results.push(BrowserResult {
                        browser: "Chrome".to_string(),
                        session_key: None,
                        debug: None,
                        error: Some(CHROME_V20_MSG.to_string()),
                    });
                }
            }
        }
    }

    // Claude Desktop instances — the main profile plus every per-instance profile
    // under ~/.claude-instances/*. Each appears as its own pick-list entry, labeled
    // with the account email when available. Errors (locked DB, decryption) surface
    // instead of being silently dropped. Listed after browsers.
    for inst in scan_claude_instances_inner() {
        // Skip profiles with nothing useful to show.
        if inst.session_key.is_none() && inst.error.is_none() {
            continue;
        }
        let browser = match (inst.instance.as_str(), inst.email.as_deref()) {
            ("main", _) => "Claude Desktop".to_string(),
            (name, Some(email)) => format!("Claude Desktop ({name} — {email})"),
            (name, None) => format!("Claude Desktop ({name})"),
        };
        results.push(BrowserResult {
            browser,
            session_key: inst.session_key,
            debug: None,
            error: inst.error,
        });
    }

    Ok(results)
}

/// Extract ChatGPT session cookie(s) from a list of rookie cookies.
/// Returns a combined Cookie header string (e.g. "name.0=val0; name.1=val1")
/// that can be used directly as the `Cookie:` header value.
fn extract_chatgpt_session(cookies: &[rookie::common::enums::Cookie]) -> Option<String> {
    const BASE: &str = "__Secure-next-auth.session-token";

    // Collect all parts: base name OR numbered chunks (.0, .1, ...)
    let mut parts: Vec<&rookie::common::enums::Cookie> = cookies
        .iter()
        .filter(|c| c.name == BASE || c.name.starts_with(&format!("{BASE}.")))
        .collect();

    if parts.is_empty() {
        return None;
    }

    // Sort by name so .0 comes before .1, etc.
    parts.sort_by(|a, b| a.name.cmp(&b.name));

    // Build Cookie header value
    let header = parts
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ");

    Some(header)
}

/// Scan browsers for a ChatGPT/Codex session cookie on chatgpt.com / openai.com.
/// Handles both single `__Secure-next-auth.session-token` and chunked `.0`/`.1` variants.
/// Returns a `session_key` that is a ready-to-use Cookie header value.
#[tauri::command]
pub fn pull_codex_session_from_browsers() -> Result<Vec<BrowserResult>, String> {
    // Cast the net wide: chatgpt.com for session token, openai.com for auth cookies
    let domains = Some(vec!["chatgpt.com".to_string(), "openai.com".to_string()]);
    let mut results = Vec::new();

    let browsers: Vec<(&str, BrowserFn)> = vec![
        ("Chrome", rookie::chrome),
        ("Firefox", rookie::firefox),
        ("Zen", rookie::zen),
        ("Arc", rookie::arc),
        ("Brave", rookie::brave),
        ("Edge", rookie::edge),
        ("Vivaldi", rookie::vivaldi),
        ("Opera", rookie::opera),
        ("Chromium", rookie::chromium),
        #[cfg(target_os = "macos")]
        ("Safari", rookie::safari),
    ];

    for (name, fetch_fn) in browsers {
        match fetch_fn(domains.clone()) {
            Ok(cookies) => {
                let session_cookie = extract_chatgpt_session(&cookies);

                let debug = if session_cookie.is_none() && !cookies.is_empty() {
                    let names: Vec<&str> = cookies.iter().map(|c| c.name.as_str()).collect();
                    Some(format!("total_cookies={}, no session-token found, names={:?}", cookies.len(), names))
                } else {
                    None
                };

                if session_cookie.is_some() || debug.is_some() {
                    results.push(BrowserResult {
                        browser: name.to_string(),
                        session_key: session_cookie,
                        debug,
                        error: None,
                    });
                }
            }
            Err(e) => {
                eprintln!("[codex-browser-scan] {}: error: {:?}", name, e);
            }
        }
    }

    // ChatGPT Desktop app on macOS — Electron app with its own Chromium cookie store.
    #[cfg(target_os = "macos")]
    {
        let cookies_path = std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
            .join("Library/Application Support/ChatGPT/Cookies");

        if cookies_path.exists() {
            let config = rookie::config::Browser {
                paths: vec![],
                channels: None,
                unix_crypt_name: None,
                osx_key_service: Some("ChatGPT Safe Storage".to_string()),
                osx_key_user: Some("ChatGPT".to_string()),
            };

            match rookie::chromium_based(&config, cookies_path, domains.clone()) {
                Ok(cookies) => {
                    if let Some(session_cookie) = extract_chatgpt_session(&cookies) {
                        results.push(BrowserResult {
                            browser: "ChatGPT Desktop".to_string(),
                            session_key: Some(session_cookie),
                            debug: None,
                            error: None,
                        });
                    }
                }
                Err(_) => {}
            }
        }
    }

    // ChatGPT Desktop app on Windows
    #[cfg(target_os = "windows")]
    {
        let chatgpt_dir = std::env::var("APPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
            .join("ChatGPT");
        let key_path = chatgpt_dir.join("Local State");

        let cookie_candidates = [
            chatgpt_dir.join("Default").join("Cookies"),
            chatgpt_dir.join("Cookies"),
        ];

        for cookies_path in &cookie_candidates {
            if !cookies_path.exists() || !key_path.exists() {
                continue;
            }

            if let Some(cookie) = read_electron_cookie_windows(&key_path, cookies_path, "__Secure-next-auth.session-token", Some(vec!["chatgpt.com".to_string(), "openai.com".to_string()])) {
                results.push(BrowserResult {
                    browser: "ChatGPT Desktop".to_string(),
                    session_key: Some(cookie),
                    debug: None,
                    error: None,
                });
                break;
            }
        }
    }

    Ok(results)
}

/// Unified browser scan for all providers.
/// Dispatches to the correct scanner based on `provider` ("Claude", "Codex", or "Cursor").
/// Returns a list of browsers where a session was found, each with the extracted credential.
#[tauri::command]
pub fn scan_browsers(provider: String) -> Result<Vec<BrowserResult>, String> {
    match provider.as_str() {
        "Claude" => pull_session_from_browsers(),
        "Codex"  => pull_codex_session_from_browsers(),
        "Cursor" => Ok(crate::commands::cursor::scan_cursor_browsers()),
        other    => Err(format!("Unknown provider: {other}")),
    }
}
