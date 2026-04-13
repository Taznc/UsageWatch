use rookie::common::enums::Cookie;
use crate::models::BrowserResult;

type BrowserFn = fn(Option<Vec<String>>) -> rookie::Result<Vec<Cookie>>;

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

/// Detailed diagnostic for Claude Desktop cookie detection on Windows.
/// Returns a list of log lines explaining each step.
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
    match copy_shared(&cookies_path, &tmp) {
        Ok(()) => log.push("✅ Copy succeeded".to_string()),
        Err(e) => {
            log.push(format!("❌ Copy failed: {e}"));
            log.push("ℹ️  Close Claude Desktop and try again, or use Browser Cookies instead".to_string());
            return log;
        }
    }

    // Use rookie's chromium_based which handles DPAPI + AES-GCM correctly
    log.push("🔑 Running rookie::chromium_based decryption...".to_string());
    match rookie::chromium_based(key_path, tmp.clone(), Some(vec!["claude.ai".to_string()])) {
        Ok(cookies) => {
            log.push(format!("✅ Decrypted {} cookies for claude.ai", cookies.len()));
            for c in &cookies {
                let preview = if c.value.len() > 20 { format!("{}...", &c.value[..20]) } else { c.value.clone() };
                log.push(format!("   name={:?} domain={} len={} val={}", c.name, c.domain, c.value.len(), preview));
            }
            if let Some(s) = cookies.iter().find(|c| c.name == "sessionKey") {
                log.push(format!("✅ sessionKey found! len={}", s.value.len()));
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

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub fn debug_claude_desktop_cookies() -> Vec<String> {
    vec!["Debug only available on Windows".to_string()]
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
                        let prefix = if c.value.len() > 30 {
                            format!("{}...", &c.value[..30])
                        } else {
                            c.value.clone()
                        };
                        format!(
                            "  [{}] domain={}, path={}, len={}, prefix={}",
                            i, c.domain, c.path, c.value.len(), prefix,
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

                // Prefer the longest sessionKey (more likely to be the full, valid one)
                let session_key = session_cookies
                    .iter()
                    .max_by_key(|c| c.value.len())
                    .map(|c| c.value.clone());

                if session_key.is_some() || debug.is_some() {
                    results.push(BrowserResult {
                        browser: name.to_string(),
                        session_key,
                        debug,
                    });
                }
            }
            Err(e) => {
                eprintln!("[browser-scan] {}: error: {:?}", name, e);
            }
        }
    }

    // Claude Desktop — Electron app with its own Chromium cookie store.
    // Checked after browsers so it appears at the end but is marked "recommended"
    // in the UI when found.
    #[cfg(target_os = "macos")]
    {
        let cookies_path = std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
            .join("Library/Application Support/Claude/Cookies");

        if cookies_path.exists() {
            let config = rookie::config::Browser {
                paths: vec![],
                channels: None,
                unix_crypt_name: None,
                osx_key_service: Some("Claude Safe Storage".to_string()),
                osx_key_user: Some("Claude".to_string()),
            };

            match rookie::chromium_based(&config, cookies_path, domains.clone()) {
                Ok(cookies) => {
                    let session_key = cookies
                        .iter()
                        .find(|c| c.name == "sessionKey")
                        .map(|c| c.value.clone());

                    if session_key.is_some() {
                        results.push(BrowserResult {
                            browser: "Claude Desktop".to_string(),
                            session_key,
                            debug: None,
                        });
                    }
                }
                Err(_) => {}
            }
        }
    }

    // Claude Desktop on Windows — Electron app, cookies in %APPDATA%\Claude\
    // Try both the flat layout and the Default profile layout.
    #[cfg(target_os = "windows")]
    {
        let claude_dir = std::env::var("APPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
            .join("Claude");
        let key_path = claude_dir.join("Local State");

        // Candidate cookie paths in priority order
        let cookie_candidates = [
            claude_dir.join("Network").join("Cookies"),  // Modern Electron (current Claude Desktop)
            claude_dir.join("Default").join("Cookies"),  // Chromium profile layout
            claude_dir.join("Cookies"),                  // Flat layout (older)
        ];

        let mut found = false;
        for cookies_path in &cookie_candidates {
            if !cookies_path.exists() || !key_path.exists() {
                continue;
            }

            match read_electron_cookie_windows(&key_path, cookies_path, "sessionKey", Some(vec!["claude.ai".to_string()])) {
                Some(session_key) => {
                    results.push(BrowserResult {
                        browser: "Claude Desktop".to_string(),
                        session_key: Some(session_key),
                        debug: None,
                    });
                    found = true;
                    break;
                }
                None => {
                    eprintln!("[claude-desktop-win] no sessionKey at {}", cookies_path.display());
                }
            }
        }

        if !found {
            let exists_info: Vec<String> = cookie_candidates
                .iter()
                .map(|p| format!("{}={}", p.display(), p.exists()))
                .collect();
            eprintln!("[claude-desktop-win] no cookies found. paths: {}", exists_info.join(", "));
        }
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
                });
                break;
            }
        }
    }

    Ok(results)
}
