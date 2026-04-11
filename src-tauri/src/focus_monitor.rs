//! macOS frontmost-application monitor.
//! Uses KVO on NSWorkspace.frontmostApplication via Objective-C FFI.

use std::ffi::{c_char, CStr};
use std::sync::Mutex;

static FRONTMOST_BUNDLE_ID: Mutex<Option<String>> = Mutex::new(None);
static FRONTMOST_APP_NAME: Mutex<Option<String>> = Mutex::new(None);

/// Callback invoked on the main thread by the Objective-C KVO observer.
extern "C" fn on_focus_changed(bundle_id: *const c_char, app_name: *const c_char) {
    let bid = if bundle_id.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(bundle_id) }
            .to_string_lossy()
            .into_owned()
    };
    let name = if app_name.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(app_name) }
            .to_string_lossy()
            .into_owned()
    };

    if let Ok(mut lock) = FRONTMOST_BUNDLE_ID.lock() {
        *lock = Some(bid);
    }
    if let Ok(mut lock) = FRONTMOST_APP_NAME.lock() {
        *lock = Some(name);
    }

    // Trigger tray re-render for the new provider
    crate::tray_state::on_focus_changed();
}

extern "C" {
    fn register_focus_callback(cb: extern "C" fn(*const c_char, *const c_char));
    fn start_focus_observation();
}

/// Start observing frontmost-application changes. Call once during app setup.
pub fn start() {
    unsafe {
        register_focus_callback(on_focus_changed);
        start_focus_observation();
    }
}

pub fn current_bundle_id() -> Option<String> {
    FRONTMOST_BUNDLE_ID.lock().ok()?.clone()
}

pub fn current_app_name() -> Option<String> {
    FRONTMOST_APP_NAME.lock().ok()?.clone()
}
