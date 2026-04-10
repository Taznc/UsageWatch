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

    Ok(results)
}
