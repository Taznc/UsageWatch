use std::sync::Mutex;

static FRONTMOST_BUNDLE_ID: Mutex<Option<String>> = Mutex::new(None);
static FRONTMOST_APP_NAME: Mutex<Option<String>> = Mutex::new(None);
static FRONTMOST_WINDOW_TITLE: Mutex<Option<String>> = Mutex::new(None);

fn set_focus(bundle_id: Option<String>, app_name: Option<String>) {
    if let Ok(mut lock) = FRONTMOST_BUNDLE_ID.lock() {
        *lock = bundle_id;
    }
    if let Ok(mut lock) = FRONTMOST_APP_NAME.lock() {
        *lock = app_name;
    }
    // Clear title on app switch; the title poller will repopulate it shortly.
    if let Ok(mut lock) = FRONTMOST_WINDOW_TITLE.lock() {
        *lock = None;
    }
    crate::tray_state::on_focus_changed();
}

fn set_title(title: Option<String>) {
    if let Ok(mut lock) = FRONTMOST_WINDOW_TITLE.lock() {
        *lock = title;
    }
    crate::tray_state::on_focus_changed();
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, CStr};

    extern "C" fn on_focus_changed(bundle_id: *const c_char, app_name: *const c_char) {
        let bid = if bundle_id.is_null() {
            None
        } else {
            Some(unsafe { CStr::from_ptr(bundle_id) }.to_string_lossy().into_owned())
        };
        let name = if app_name.is_null() {
            None
        } else {
            Some(unsafe { CStr::from_ptr(app_name) }.to_string_lossy().into_owned())
        };
        super::set_focus(bid, name);
    }

    extern "C" fn on_title_changed(title: *const c_char) {
        let t = if title.is_null() {
            None
        } else {
            let s = unsafe { CStr::from_ptr(title) }.to_string_lossy().into_owned();
            if s.is_empty() { None } else { Some(s) }
        };
        super::set_title(t);
    }

    extern "C" {
        fn register_focus_callback(cb: extern "C" fn(*const c_char, *const c_char));
        fn start_focus_observation();
        fn register_title_callback(cb: extern "C" fn(*const c_char));
        fn start_title_polling();
        fn stop_title_polling();
        fn check_accessibility_trusted() -> bool;
        fn request_accessibility_access() -> bool;
    }

    pub fn start() {
        unsafe {
            register_focus_callback(on_focus_changed);
            start_focus_observation();
        }
    }

    pub fn start_title_watch() {
        unsafe {
            register_title_callback(on_title_changed);
            start_title_polling();
        }
    }

    pub fn stop_title_watch() {
        unsafe { stop_title_polling(); }
    }

    pub fn is_accessibility_trusted() -> bool {
        unsafe { check_accessibility_trusted() }
    }

    pub fn request_accessibility() -> bool {
        unsafe { request_accessibility_access() }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{path::Path, thread, time::Duration};
    use windows::{
        core::PWSTR,
        Win32::{
            Foundation::CloseHandle,
            System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION},
            UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId},
        },
    };

    fn current_foreground_info() -> Option<(String, Option<String>)> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }

        // Process name
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = vec![0u16; 260];
        let mut len = buf.len() as u32;
        let ok = unsafe {
            QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len)
        }.is_ok();
        let _ = unsafe { CloseHandle(handle) };
        if !ok || len == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let app_name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())?;

        // Window title (no permission needed on Windows)
        let title_len = unsafe { GetWindowTextLengthW(hwnd) };
        let window_title = if title_len > 0 {
            let mut tbuf = vec![0u16; (title_len + 1) as usize];
            let actual = unsafe { GetWindowTextW(hwnd, &mut tbuf) };
            if actual > 0 {
                let s = String::from_utf16_lossy(&tbuf[..actual as usize]);
                if !s.is_empty() { Some(s) } else { None }
            } else {
                None
            }
        } else {
            None
        };

        Some((app_name, window_title))
    }

    pub fn start() {
        thread::spawn(|| {
            let mut last_app = String::new();
            let mut last_title = String::new();
            loop {
                if let Some((app_name, window_title)) = current_foreground_info() {
                    let norm_app = app_name.to_ascii_lowercase();
                    let norm_title = window_title.as_deref().unwrap_or("").to_ascii_lowercase();
                    if norm_app != last_app {
                        last_app = norm_app;
                        last_title = norm_title;
                        super::set_focus(None, Some(app_name));
                        super::set_title(window_title);
                    } else if norm_title != last_title {
                        last_title = norm_title;
                        super::set_title(window_title);
                    }
                }
                thread::sleep(Duration::from_millis(650));
            }
        });
    }

    // No-ops on Windows — accessibility is not required
    pub fn start_title_watch() {}
    pub fn stop_title_watch() {}
    pub fn is_accessibility_trusted() -> bool { true }
    pub fn request_accessibility() -> bool { true }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn start() {}
    pub fn start_title_watch() {}
    pub fn stop_title_watch() {}
    pub fn is_accessibility_trusted() -> bool { true }
    pub fn request_accessibility() -> bool { true }
}

pub fn start() {
    platform::start();
}

pub fn start_title_watch() {
    platform::start_title_watch();
}

pub fn stop_title_watch() {
    platform::stop_title_watch();
}

pub fn is_accessibility_trusted() -> bool {
    platform::is_accessibility_trusted()
}

pub fn request_accessibility() -> bool {
    platform::request_accessibility()
}

pub fn current_bundle_id() -> Option<String> {
    FRONTMOST_BUNDLE_ID.lock().ok()?.clone()
}

pub fn current_app_name() -> Option<String> {
    FRONTMOST_APP_NAME.lock().ok()?.clone()
}

pub fn current_window_title() -> Option<String> {
    FRONTMOST_WINDOW_TITLE.lock().ok()?.clone()
}
