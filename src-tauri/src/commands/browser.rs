use rookie::common::enums::Cookie;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserResult {
    pub browser: String,
    pub session_key: Option<String>,
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
                let session_key = cookies
                    .iter()
                    .find(|c| c.name == "sessionKey")
                    .map(|c| c.value.clone());

                if session_key.is_some() {
                    results.push(BrowserResult {
                        browser: name.to_string(),
                        session_key,
                    });
                }
            }
            Err(_) => {
                // Browser not installed or no access — skip
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
