use std::sync::Mutex;

static FRONTMOST_BUNDLE_ID: Mutex<Option<String>> = Mutex::new(None);
static FRONTMOST_APP_NAME: Mutex<Option<String>> = Mutex::new(None);

fn set_focus(bundle_id: Option<String>, app_name: Option<String>) {
    if let Ok(mut lock) = FRONTMOST_BUNDLE_ID.lock() {
        *lock = bundle_id;
    }
    if let Ok(mut lock) = FRONTMOST_APP_NAME.lock() {
        *lock = app_name;
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
            Some(
                unsafe { CStr::from_ptr(bundle_id) }
                    .to_string_lossy()
                    .into_owned(),
            )
        };

        let name = if app_name.is_null() {
            None
        } else {
            Some(
                unsafe { CStr::from_ptr(app_name) }
                    .to_string_lossy()
                    .into_owned(),
            )
        };

        super::set_focus(bid, name);
    }

    extern "C" {
        fn register_focus_callback(cb: extern "C" fn(*const c_char, *const c_char));
        fn start_focus_observation();
    }

    pub fn start() {
        unsafe {
            register_focus_callback(on_focus_changed);
            start_focus_observation();
        }
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
            UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    };

    fn current_process_name() -> Option<String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = vec![0u16; 260];
        let mut len = buf.len() as u32;

        let ok = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
        }
        .is_ok();
        let _ = unsafe { CloseHandle(handle) };

        if !ok || len == 0 {
            return None;
        }

        let path = String::from_utf16_lossy(&buf[..len as usize]);
        Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
    }

    pub fn start() {
        thread::spawn(|| {
            let mut last_seen = String::new();
            loop {
                if let Some(app_name) = current_process_name() {
                    let normalized = app_name.to_ascii_lowercase();
                    if normalized != last_seen {
                        last_seen = normalized;
                        super::set_focus(None, Some(app_name));
                    }
                }
                thread::sleep(Duration::from_millis(650));
            }
        });
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn start() {}
}

pub fn start() {
    platform::start();
}

pub fn current_bundle_id() -> Option<String> {
    FRONTMOST_BUNDLE_ID.lock().ok()?.clone()
}

pub fn current_app_name() -> Option<String> {
    FRONTMOST_APP_NAME.lock().ok()?.clone()
}
