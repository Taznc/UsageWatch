//! macOS native styled tray title via Objective-C FFI.

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{CStr, CString, c_char, c_int, c_void};

    #[repr(C)]
    struct CTraySegment {
        text: *const c_char,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        font_size: f32,
        is_bold: c_int,
    }

    extern "C" {
        fn set_styled_tray_title_with_icon(
            segments: *const CTraySegment,
            count: c_int,
            icon_data: *const u8,
            icon_len: c_int,
        );
        fn register_tray_status_item(status_item: *mut c_void);
        fn register_mouse_move_callback(cb: extern "C" fn(f64, f64));
        fn start_native_mouse_monitor();
        fn start_widget_drag_monitor();
        fn set_widget_drag_rect(x: f32, y: f32, w: f32, h: f32);
    }

    #[derive(Debug, Clone)]
    pub struct StyledSegment {
        pub text: String,
        pub r: f32,
        pub g: f32,
        pub b: f32,
        pub a: f32,
        pub font_size: f32,
        pub is_bold: bool,
    }

    impl StyledSegment {
        pub fn from_rgba_u8(
            text: &str, r: u8, g: u8, b: u8, a: u8, font_size: f64, is_bold: bool,
        ) -> Self {
            Self {
                text: text.to_string(),
                r: r as f32 / 255.0,
                g: g as f32 / 255.0,
                b: b as f32 / 255.0,
                a: a as f32 / 255.0,
                font_size: font_size as f32,
                is_bold,
            }
        }
    }

    pub fn set_native_styled_title_with_icon(segments: &[StyledSegment], icon_name: Option<&str>) {
        if segments.is_empty() {
            return;
        }

        static CLAUDE_ICON: &[u8] = include_bytes!("../icons/providers/claude.png");
        static CODEX_ICON: &[u8] = include_bytes!("../icons/providers/codex.png");
        static CURSOR_ICON: &[u8] = include_bytes!("../icons/providers/cursor.png");

        let icon_bytes: Option<&[u8]> = icon_name.and_then(|name| match name {
            "claude" => Some(CLAUDE_ICON),
            "codex" => Some(CODEX_ICON),
            "cursor" => Some(CURSOR_ICON),
            _ => None,
        });

        let c_strings: Vec<CString> = segments
            .iter()
            .map(|s| CString::new(s.text.as_str()).unwrap_or_default())
            .collect();

        let c_segments: Vec<CTraySegment> = segments
            .iter()
            .zip(c_strings.iter())
            .map(|(seg, cs)| CTraySegment {
                text: cs.as_ptr(),
                r: seg.r,
                g: seg.g,
                b: seg.b,
                a: seg.a,
                font_size: seg.font_size,
                is_bold: if seg.is_bold { 1 } else { 0 },
            })
            .collect();

        let icon_ptr = icon_bytes.map(|b| b.as_ptr()).unwrap_or(std::ptr::null());
        let icon_len = icon_bytes.map(|b| b.len() as c_int).unwrap_or(0);

        unsafe {
            set_styled_tray_title_with_icon(
                c_segments.as_ptr(),
                c_segments.len() as c_int,
                icon_ptr,
                icon_len,
            );
        }
    }

    pub fn register_native_status_item(status_item: *mut c_void) {
        unsafe {
            register_tray_status_item(status_item);
        }
    }

    pub fn register_native_mouse_callback(cb: extern "C" fn(f64, f64)) {
        unsafe { register_mouse_move_callback(cb) }
    }

    pub fn start_mouse_monitor() {
        unsafe { start_native_mouse_monitor() }
    }

    pub fn setup_widget_drag_monitor() {
        unsafe { start_widget_drag_monitor() }
    }

    pub fn update_widget_drag_rect(x: f32, y: f32, w: f32, h: f32) {
        unsafe { set_widget_drag_rect(x, y, w, h) }
    }

    // ── Running apps FFI ──────────────────────────────────────────────────

    #[repr(C)]
    struct CRunningApp {
        bundle_id: *const c_char,
        name: *const c_char,
    }

    extern "C" {
        fn get_running_gui_apps(out_apps: *mut *mut CRunningApp) -> c_int;
        fn free_running_apps(apps: *mut CRunningApp, count: c_int);
    }

    pub fn list_running_apps() -> Vec<crate::models::RunningApp> {
        unsafe {
            let mut apps_ptr: *mut CRunningApp = std::ptr::null_mut();
            let count = get_running_gui_apps(&mut apps_ptr);
            let mut result = Vec::with_capacity(count as usize);
            for i in 0..count as isize {
                let app = &*apps_ptr.offset(i);
                let bundle_id = CStr::from_ptr(app.bundle_id).to_string_lossy().into_owned();
                let name = CStr::from_ptr(app.name).to_string_lossy().into_owned();
                result.push(crate::models::RunningApp { bundle_id, name });
            }
            free_running_apps(apps_ptr, count);
            result
        }
    }
}
