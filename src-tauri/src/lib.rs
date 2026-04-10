mod commands;
mod credentials_cache;
mod models;
mod polling;

use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

use credentials_cache::CredentialsCache;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let poll_interval = Arc::new(Mutex::new(60u64));
    let poll_interval_clone = poll_interval.clone();

    // Create credential cache and load from keychain once at startup
    let cache = Arc::new(CredentialsCache::new());
    cache.load_from_keychain();
    let cache_for_polling = cache.clone();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:usage_history.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create usage_history table",
                        sql: "CREATE TABLE IF NOT EXISTS usage_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            timestamp TEXT NOT NULL,
                            five_hour_pct REAL,
                            five_hour_reset_at TEXT,
                            seven_day_pct REAL,
                            seven_day_reset_at TEXT,
                            seven_day_opus_pct REAL,
                            extra_spending REAL,
                            extra_budget REAL
                        )",
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(poll_interval.clone())
        .manage(cache.clone())
        .invoke_handler(tauri::generate_handler![
            commands::credentials::save_session_key,
            commands::credentials::get_session_key,
            commands::credentials::delete_session_key,
            commands::credentials::save_org_id,
            commands::credentials::get_org_id,
            commands::credentials::test_connection,
            commands::usage::fetch_usage,
            commands::usage::fetch_usage_raw,
            commands::usage::fetch_status,
            set_poll_interval,
        ])
        .setup(move |app| {
            let handle = app.handle();

            // Build tray menu
            let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&refresh, &settings, &quit])?;

            // Build tray icon
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .title("--")
                .tooltip("Claude Usage Tracker")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "refresh" => {
                        let _ = app.emit("refresh-requested", ());
                    }
                    "settings" => {
                        let _ = app.emit("open-settings", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Start background polling
            polling::start_polling(handle, poll_interval_clone, cache_for_polling);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn set_poll_interval(
    interval: u64,
    state: tauri::State<'_, Arc<Mutex<u64>>>,
) -> Result<(), String> {
    let interval = interval.max(30); // enforce minimum
    let mut lock = state.lock().map_err(|e| e.to_string())?;
    *lock = interval;
    Ok(())
}
