use rookie::common::enums::Cookie;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserResult {
    pub browser: String,
    pub session_key: Option<String>,
    /// Debug info: how many cookies found, key prefix, key length
    pub debug: Option<String>,
}

type BrowserFn = fn(Option<Vec<String>>) -> rookie::Result<Vec<Cookie>>;

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

    // Claude Desktop — Electron app with its own Chromium cookie store
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

            match rookie::chromium_based(&config, cookies_path, domains) {
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
                Err(_) => {
                    // Claude Desktop not accessible — skip
                }
            }
        }
    }

    Ok(results)
}
