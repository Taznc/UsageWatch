mod commands;
mod credentials_cache;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod focus_monitor;
mod hook;
mod http_server;
mod models;
mod polling;
#[cfg(target_os = "macos")]
mod styled_tray;
mod tray_renderer;
mod tray_state;

use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
#[cfg(target_os = "macos")]
use objc2::rc::Retained;

use credentials_cache::CredentialsCache;

/// Browser-like User-Agent to avoid Cloudflare challenges when calling claude.ai APIs.
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
use models::{AlertConfig, TrayConfig, TrayFormat};
use polling::{CodexUpdate, CursorUpdate, UsageUpdate};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let poll_interval = Arc::new(Mutex::new(60u64));
    let poll_interval_clone = poll_interval.clone();

    let cache = Arc::new(CredentialsCache::new());
    let cache_for_polling = cache.clone();

    let tray_format = Arc::new(Mutex::new(TrayFormat::default()));

    let tray_config = Arc::new(Mutex::new(TrayConfig::default()));
    let tray_config_for_state = tray_config.clone();

    let alert_config = Arc::new(Mutex::new(AlertConfig::default()));

    let latest_usage: Arc<Mutex<Option<UsageUpdate>>> = Arc::new(Mutex::new(None));
    let latest_usage_for_polling = latest_usage.clone();
    let latest_usage_for_server = latest_usage.clone();

    let latest_codex: Arc<Mutex<Option<CodexUpdate>>> = Arc::new(Mutex::new(None));
    let latest_codex_for_polling = latest_codex.clone();

    let latest_cursor: Arc<Mutex<Option<CursorUpdate>>> = Arc::new(Mutex::new(None));
    let latest_cursor_for_polling = latest_cursor.clone();

    let latest_billing: Arc<Mutex<Option<polling::BillingUpdate>>> = Arc::new(Mutex::new(None));
    let latest_billing_for_polling = latest_billing.clone();
    let latest_billing_for_server = latest_billing.clone();

    let tray_format_for_state = tray_format.clone();
    let latest_usage_for_state = latest_usage.clone();
    let latest_codex_for_state = latest_codex.clone();
    let latest_cursor_for_state = latest_cursor.clone();

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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(poll_interval.clone())
        .manage(cache.clone())
        .manage(tray_format.clone())
        .manage(tray_config.clone())
        .manage(alert_config.clone())
        .manage(latest_usage.clone())
        .manage(latest_codex.clone())
        .manage(latest_cursor.clone())
        .manage(latest_billing.clone())
        .invoke_handler(tauri::generate_handler![
            commands::credentials::save_session_key,
            commands::credentials::get_session_key,
            commands::credentials::delete_session_key,
            commands::credentials::save_org_id,
            commands::credentials::get_org_id,
            refresh_all_providers,
            commands::credentials::test_connection,
            commands::usage::fetch_usage,
            commands::usage::fetch_usage_raw,
            commands::browser::pull_session_from_browsers,
            commands::browser::pull_codex_session_from_browsers,
            commands::browser::debug_claude_desktop_cookies,
            commands::browser::scan_browsers,
            commands::usage::fetch_billing,
            commands::codex::check_codex_auth,
            commands::codex::fetch_codex_usage,
            commands::codex::test_codex_connection,
            commands::codex::save_codex_token,
            commands::codex::get_codex_token,
            commands::codex::save_codex_browser_cookie,
            commands::codex::get_codex_browser_cookie,
            commands::codex::test_codex_browser_cookie,
            commands::cursor::check_cursor_auth,
            commands::cursor::check_cursor_desktop_auth,
            commands::cursor::pull_cursor_session_from_browsers,
            commands::cursor::test_cursor_connection,
            commands::cursor::save_cursor_token,
            commands::cursor::get_cursor_token,
            commands::cursor::fetch_cursor_usage,
            commands::cursor::get_cursor_email,
            commands::cursor::get_cursor_auth_path,
            commands::cursor::debug_cursor_api,
            commands::claude_oauth::check_claude_oauth,
            commands::claude_oauth::set_claude_auth_method,
            commands::claude_oauth::get_claude_auth_method,
            set_poll_interval,
            get_tray_format,
            set_tray_format,
            get_tray_config,
            set_tray_config,
            get_running_apps,
            get_alert_config,
            set_alert_config,
            get_http_server_enabled,
            set_http_server_enabled,
            get_latest_usage_update,
            get_latest_codex_update,
            get_latest_cursor_update,
            get_active_provider,
            check_accessibility_permission,
            request_accessibility_permission,
            set_title_matching_enabled,
            set_widget_drag_rect,
            force_widget_transparent,
        ])
        .setup(move |app| {
            // Hide dock icon on macOS (agent/accessory app)
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let handle = app.handle();

            // Load saved credentials from store file into memory cache
            commands::credentials::load_credentials_from_store(handle, &cache);

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_maximizable(false);
                #[cfg(target_os = "windows")]
                configure_main_hwnd(&main_window);
            }

            if let Some(widget_window) = app.get_webview_window("widget") {
                let _ = widget_window.set_maximizable(false);
                #[cfg(target_os = "windows")]
                configure_widget_hwnd(&widget_window);

                // Force both window and webview backgrounds to fully transparent.
                let _ = widget_window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

                hook::start_global_mouse_stream(widget_window);
            }

            #[cfg(target_os = "macos")]
            styled_tray::setup_widget_drag_monitor();

            // Load tray format and tray config from store
            load_tray_format_from_store(handle, &tray_format);
            load_tray_config_from_store(handle, &tray_config);
            load_alert_config_from_store(handle, &alert_config);

            // Restore widget position + visibility from previous session (see widget_layout / widget_visible in credentials.json)
            restore_widget_window_from_store(handle);

            // Build tray menu
            let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "widget", "Widget", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&refresh, &settings, &widget, &quit])?;

            // Build tray icon
            let tray_menu = menu;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .title("--")
                .tooltip("UsageWatch")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "refresh" => {
                        let app = app.clone();
                        let cache = (*app.state::<Arc<CredentialsCache>>()).clone();
                        let latest_usage = (*app.state::<Arc<Mutex<Option<UsageUpdate>>>>()).clone();
                        let latest_codex = (*app.state::<Arc<Mutex<Option<CodexUpdate>>>>()).clone();
                        let latest_cursor = (*app.state::<Arc<Mutex<Option<CursorUpdate>>>>()).clone();
                        let latest_billing = (*app.state::<Arc<Mutex<Option<polling::BillingUpdate>>>>()).clone();
                        tauri::async_runtime::spawn(async move {
                            polling::poll_all_providers(
                                &app,
                                cache.as_ref(),
                                &latest_usage,
                                &latest_codex,
                                &latest_cursor,
                                &latest_billing,
                            )
                            .await;
                        });
                    }
                    "settings" => {
                        let _ = app.emit("open-settings", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "widget" => {
                        if let Some(w) = app.get_webview_window("widget") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                                save_widget_visible_to_store(app, false);
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                                save_widget_visible_to_store(app, true);
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    match &event {
                        tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                        let rect = rect.clone();
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // Tray rect is in physical pixels; scale window dimensions
                                // (logical pts) to physical so centering is correct on HiDPI.
                                let scale = window.scale_factor().unwrap_or(1.0);
                                let window_width_px = 380.0_f64 * scale;
                                let window_height_px = 800.0_f64 * scale;
                                let (icon_w, icon_h) = match rect.size {
                                    tauri::Size::Physical(s) => {
                                        (s.width as f64, s.height as f64)
                                    }
                                    tauri::Size::Logical(s) => {
                                        (s.width * scale, s.height * scale)
                                    }
                                };
                                let (icon_x, icon_y) = match rect.position {
                                    tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                                    tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
                                };
                                let icon_center_x = icon_x + icon_w / 2.0;
                                let x = icon_center_x - window_width_px / 2.0;

                                // On macOS the tray is at the top — open below it.
                                // On Windows the tray is at the bottom — open above it.
                                let y = if cfg!(target_os = "macos") {
                                    icon_y + icon_h + 4.0
                                } else {
                                    icon_y - window_height_px - 4.0
                                };

                                let _ = window.set_position(
                                    tauri::PhysicalPosition::new(x as i32, y as i32),
                                );
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = app.emit("window-opened", ());
                            }
                        }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            {
                let _ = tray.with_inner_tray_icon(|inner| {
                    if let Some(status_item) = inner.ns_status_item() {
                        let ptr = Retained::as_ptr(&status_item) as *mut std::ffi::c_void;
                        crate::styled_tray::register_native_status_item(ptr);
                    }
                });
            }

            // Initialize global tray state for provider-aware rendering
            tray_state::init(tray_state::TrayState {
                app_handle: handle.clone(),
                tray_config: tray_config_for_state,
                tray_format: tray_format_for_state,
                latest_usage: latest_usage_for_state,
                latest_codex: latest_codex_for_state,
                latest_cursor: latest_cursor_for_state,
            });

            // Start focused-app observation for provider-aware tray/widget switching.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            focus_monitor::start();

            // If title matching was previously enabled and (on macOS) accessibility is trusted,
            // resume the title polling immediately.
            {
                let cfg = tray_config.lock().unwrap().clone();
                if cfg.title_matching_enabled {
                    #[cfg(target_os = "macos")]
                    if focus_monitor::is_accessibility_trusted() {
                        focus_monitor::start_title_watch();
                    }
                    #[cfg(target_os = "windows")]
                    focus_monitor::start_title_watch();
                }
            }

            // Start local HTTP API if enabled (used by MCP server and Stream Deck integrations)
            if is_http_server_enabled(handle) {
                http_server::start(handle.clone(), latest_usage_for_server, latest_codex.clone(), latest_cursor.clone(), latest_billing_for_server);
            }

            // Start background polling (Claude, Codex, Cursor refresh together on each tick)
            polling::start_unified_polling(
                handle,
                poll_interval_clone,
                cache_for_polling,
                latest_usage_for_polling,
                latest_codex_for_polling,
                latest_cursor_for_polling,
                latest_billing_for_polling,
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn set_widget_drag_rect(x: f32, y: f32, w: f32, h: f32) {
    #[cfg(target_os = "macos")]
    styled_tray::update_widget_drag_rect(x, y, w, h);
    #[cfg(not(target_os = "macos"))]
    let _ = (x, y, w, h);
}

/// On Windows, strip the resize frame and maximize style to prevent double-click
/// maximize, Aero Snap, and the resize-frame border with `decorations: false`.
#[cfg(target_os = "windows")]
fn apply_win32_borderless_styles(hwnd_raw: *mut std::ffi::c_void, tool_window: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, GWL_STYLE, WS_EX_TOOLWINDOW,
        WS_MAXIMIZEBOX, WS_THICKFRAME,
    };

    let hwnd = HWND(hwnd_raw);

    unsafe {
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        SetWindowLongW(
            hwnd,
            GWL_STYLE,
            (style & !WS_MAXIMIZEBOX.0 & !WS_THICKFRAME.0) as i32,
        );

        if tool_window {
            // Skips taskbar and reduces snap behavior for the overlay widget.
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongW(
                hwnd,
                GWL_EXSTYLE,
                (ex_style | WS_EX_TOOLWINDOW.0) as i32,
            );
        }

        // Remove the 1px DWM border that Windows 11 adds to borderless windows.
        // DWMWA_BORDER_COLOR (34) set to DWMWA_COLOR_NONE (0xFFFFFFFE).
        let color_none: u32 = 0xFFFF_FFFE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWINDOWATTRIBUTE(34),
            &color_none as *const u32 as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(target_os = "windows")]
fn configure_main_hwnd(main: &tauri::WebviewWindow) {
    if let Ok(hwnd) = main.hwnd() {
        apply_win32_borderless_styles(hwnd.0, false);
    }
}

/// Widget: same as main, plus tool-window exstyle and transparency guarantee.
#[cfg(target_os = "windows")]
fn configure_widget_hwnd(widget: &tauri::WebviewWindow) {
    if let Ok(hwnd) = widget.hwnd() {
        apply_win32_borderless_styles(hwnd.0, true);

        // Explicitly ensure WS_EX_NOREDIRECTIONBITMAP so DWM composites the
        // window without an opaque backing surface.  tao should set this when
        // `transparent: true` but we re-apply after style changes to be safe.
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE};
        const WS_EX_NOREDIRECTIONBITMAP: u32 = 0x0020_0000;
        unsafe {
            let ex = GetWindowLongW(HWND(hwnd.0), GWL_EXSTYLE) as u32;
            if ex & WS_EX_NOREDIRECTIONBITMAP == 0 {
                SetWindowLongW(
                    HWND(hwnd.0),
                    GWL_EXSTYLE,
                    (ex | WS_EX_NOREDIRECTIONBITMAP) as i32,
                );
            }
        }
    }
}

/// Called from the widget frontend after mount to guarantee the WebView2
/// controller is initialised before we set its background to transparent.
#[tauri::command]
fn force_widget_transparent(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    }
}

#[tauri::command]
fn set_poll_interval(
    interval: u64,
    state: tauri::State<'_, Arc<Mutex<u64>>>,
) -> Result<(), String> {
    let interval = interval.max(30);
    let mut lock = state.lock().map_err(|e| e.to_string())?;
    *lock = interval;
    Ok(())
}

#[tauri::command]
fn get_tray_format(state: tauri::State<'_, Arc<Mutex<TrayFormat>>>) -> Result<TrayFormat, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn set_tray_format(
    app: tauri::AppHandle,
    format: TrayFormat,
    state: tauri::State<'_, Arc<Mutex<TrayFormat>>>,
) -> Result<(), String> {
    {
        let mut lock = state.lock().map_err(|e| e.to_string())?;
        *lock = format.clone();
    }
    save_tray_format_to_store(&app, &format);
    // Re-render with cached data for the current provider
    tray_state::refresh_tray();
    Ok(())
}

#[tauri::command]
fn get_tray_config(
    state: tauri::State<'_, Arc<Mutex<TrayConfig>>>,
) -> Result<TrayConfig, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn set_tray_config(
    app: tauri::AppHandle,
    config: TrayConfig,
    state: tauri::State<'_, Arc<Mutex<TrayConfig>>>,
) -> Result<(), String> {
    {
        let mut lock = state.lock().map_err(|e| e.to_string())?;
        *lock = config.clone();
    }
    save_tray_config_to_store(&app, &config);
    tray_state::refresh_tray();
    Ok(())
}

#[tauri::command]
fn get_running_apps() -> Vec<models::RunningApp> {
    #[cfg(target_os = "macos")]
    {
        styled_tray::list_running_apps()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[tauri::command]
fn check_accessibility_permission() -> bool {
    focus_monitor::is_accessibility_trusted()
}

#[tauri::command]
fn request_accessibility_permission() -> bool {
    focus_monitor::request_accessibility()
}

#[tauri::command]
fn set_title_matching_enabled(
    enabled: bool,
    state: tauri::State<'_, Arc<Mutex<TrayConfig>>>,
) -> Result<(), String> {
    {
        let mut cfg = state.lock().map_err(|e| e.to_string())?;
        cfg.title_matching_enabled = enabled;
    }
    if enabled {
        #[cfg(target_os = "macos")]
        if focus_monitor::is_accessibility_trusted() {
            focus_monitor::start_title_watch();
        }
        #[cfg(target_os = "windows")]
        focus_monitor::start_title_watch();
    } else {
        focus_monitor::stop_title_watch();
    }
    tray_state::refresh_tray();
    Ok(())
}

#[tauri::command]
fn get_alert_config(
    state: tauri::State<'_, Arc<Mutex<AlertConfig>>>,
) -> Result<AlertConfig, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn set_alert_config(
    app: tauri::AppHandle,
    config: AlertConfig,
    state: tauri::State<'_, Arc<Mutex<AlertConfig>>>,
) -> Result<(), String> {
    {
        let mut lock = state.lock().map_err(|e| e.to_string())?;
        *lock = config.clone();
    }
    save_alert_config_to_store(&app, &config);
    Ok(())
}

#[tauri::command]
fn get_http_server_enabled(app: tauri::AppHandle) -> bool {
    is_http_server_enabled(&app)
}

#[tauri::command]
fn set_http_server_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("credentials.json").map_err(|e| e.to_string())?;
    store.set("http_server_enabled", serde_json::Value::Bool(enabled));
    let _ = store.save();
    Ok(())
}

#[tauri::command]
async fn refresh_all_providers(
    app: tauri::AppHandle,
    cache: tauri::State<'_, Arc<CredentialsCache>>,
    latest_usage: tauri::State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
    latest_codex: tauri::State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
    latest_cursor: tauri::State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
    latest_billing: tauri::State<'_, Arc<Mutex<Option<polling::BillingUpdate>>>>,
) -> Result<(), String> {
    polling::poll_all_providers(
        &app,
        &**cache,
        &*latest_usage,
        &*latest_codex,
        &*latest_cursor,
        &*latest_billing,
    )
    .await;
    Ok(())
}

#[tauri::command]
fn get_latest_usage_update(
    state: tauri::State<'_, Arc<Mutex<Option<UsageUpdate>>>>,
) -> Result<Option<UsageUpdate>, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn get_latest_codex_update(
    state: tauri::State<'_, Arc<Mutex<Option<CodexUpdate>>>>,
) -> Result<Option<CodexUpdate>, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn get_latest_cursor_update(
    state: tauri::State<'_, Arc<Mutex<Option<CursorUpdate>>>>,
) -> Result<Option<CursorUpdate>, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn get_active_provider() -> Result<models::Provider, String> {
    crate::tray_state::current_provider().ok_or_else(|| "provider unavailable".to_string())
}

fn load_tray_format_from_store(app: &tauri::AppHandle, tray_format: &Arc<Mutex<TrayFormat>>) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Some(val) = store.get("tray_format") {
            if let Ok(fmt) = serde_json::from_value::<TrayFormat>(val.clone()) {
                *tray_format.lock().unwrap() = fmt;
            }
        }
    }
}

fn save_tray_format_to_store(app: &tauri::AppHandle, format: &TrayFormat) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Ok(val) = serde_json::to_value(format) {
            store.set("tray_format", val);
            let _ = store.save();
        }
    }
}

fn load_tray_config_from_store(app: &tauri::AppHandle, tray_config: &Arc<Mutex<TrayConfig>>) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Some(val) = store.get("tray_config") {
            if let Ok(mut cfg) = serde_json::from_value::<TrayConfig>(val.clone()) {
                // If Dynamic with no mappings, seed with defaults so switching works
                // out of the box (covers upgrades from older configs).
                if matches!(cfg.mode, models::TrayMode::Dynamic) && cfg.app_mappings.is_empty() {
                    cfg.app_mappings = TrayConfig::default().app_mappings;
                    save_tray_config_to_store(app, &cfg);
                }
                *tray_config.lock().unwrap() = cfg;
            }
        }
    }
}

fn save_tray_config_to_store(app: &tauri::AppHandle, config: &TrayConfig) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Ok(val) = serde_json::to_value(config) {
            store.set("tray_config", val);
            let _ = store.save();
        }
    }
}

fn load_alert_config_from_store(app: &tauri::AppHandle, alert_config: &Arc<Mutex<AlertConfig>>) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Some(val) = store.get("alert_config") {
            if let Ok(cfg) = serde_json::from_value::<AlertConfig>(val.clone()) {
                *alert_config.lock().unwrap() = cfg;
            }
        }
    }
}

fn save_alert_config_to_store(app: &tauri::AppHandle, config: &AlertConfig) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Ok(val) = serde_json::to_value(config) {
            store.set("alert_config", val);
            let _ = store.save();
        }
    }
}

fn is_http_server_enabled(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        if let Some(val) = store.get("http_server_enabled") {
            return val.as_bool().unwrap_or(false);
        }
    }
    false
}

fn save_widget_visible_to_store(app: &tauri::AppHandle, visible: bool) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("credentials.json") {
        store.set("widget_visible", serde_json::Value::Bool(visible));
        let _ = store.save();
    }
}

fn json_value_as_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().filter(|x| x.is_finite()),
        serde_json::Value::String(s) => s.parse::<f64>().ok().filter(|x| x.is_finite()),
        _ => None,
    }
}

/// `widget_layout` from the frontend store (`WIDGET_LAYOUT_STORE_KEY`).
fn widget_layout_logical_position(layout: &serde_json::Value) -> Option<(f64, f64)> {
    let pos = layout.get("position")?;
    let x = json_value_as_f64(pos.get("x")?)?;
    let y = json_value_as_f64(pos.get("y")?)?;
    Some((x, y))
}

fn restore_widget_window_from_store(app: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("credentials.json") else {
        return;
    };
    let Some(w) = app.get_webview_window("widget") else {
        return;
    };

    if let Some(layout) = store.get("widget_layout") {
        if let Some((x, y)) = widget_layout_logical_position(&layout) {
            let _ = w.set_position(tauri::LogicalPosition::new(x, y));
        }
    }

    if store.get("widget_visible").and_then(|v| v.as_bool()) == Some(true) {
        let _ = w.show();
    }
}
