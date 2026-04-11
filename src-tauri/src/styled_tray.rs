//! macOS native styled tray title via Objective-C FFI.

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::ffi::c_void;

    #[repr(C)]
    struct CTraySegment {
        text: *const std::ffi::c_char,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        font_size: f32,
        is_bold: std::ffi::c_int,
    }

    extern "C" {
        fn set_styled_tray_title(segments: *const CTraySegment, count: std::ffi::c_int);
        fn register_tray_status_item(status_item: *mut c_void);
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

    pub fn set_native_styled_title(segments: &[StyledSegment]) {
        if segments.is_empty() {
            return;
        }

        // Convert to C strings (must keep them alive during the call)
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

        unsafe {
            set_styled_tray_title(c_segments.as_ptr(), c_segments.len() as std::ffi::c_int);
        }
    }

    pub fn register_native_status_item(status_item: *mut c_void) {
        unsafe {
            register_tray_status_item(status_item);
        }
    }
}
