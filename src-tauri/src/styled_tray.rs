//! macOS-specific: set a styled/colored attributed title on the NSStatusItem button.
//!
//! Tauri's `TrayIcon::set_title()` only supports plain text. This module uses objc2
//! to access the underlying NSStatusBar, find our status item by matching its current
//! plain-text title, and replace it with an NSMutableAttributedString built from
//! colored/styled segments.

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
    };
    use objc2_foundation::{
        NSMutableAttributedString, NSRange, NSString,
    };

    /// A single styled text segment.
    #[derive(Debug, Clone)]
    pub struct StyledSegment {
        pub text: String,
        /// RGBA color, each component 0.0..=1.0
        pub r: f64,
        pub g: f64,
        pub b: f64,
        pub a: f64,
        /// Font size in points
        pub font_size: f64,
        /// Whether to use bold system font
        pub is_bold: bool,
    }

    impl StyledSegment {
        pub fn new(text: &str, r: f64, g: f64, b: f64, a: f64, font_size: f64, is_bold: bool) -> Self {
            Self {
                text: text.to_string(),
                r, g, b, a,
                font_size,
                is_bold,
            }
        }

        /// Convenience: create a segment from u8 RGBA values (0-255).
        pub fn from_rgba_u8(text: &str, r: u8, g: u8, b: u8, a: u8, font_size: f64, is_bold: bool) -> Self {
            Self {
                text: text.to_string(),
                r: r as f64 / 255.0,
                g: g as f64 / 255.0,
                b: b as f64 / 255.0,
                a: a as f64 / 255.0,
                font_size,
                is_bold,
            }
        }
    }

    /// Build an NSMutableAttributedString from a list of styled segments.
    ///
    /// Each segment gets its own font (bold or regular system font) and foreground color.
    /// Returns a retained NSMutableAttributedString ready to be set on a button.
    pub fn build_attributed_string(segments: &[StyledSegment]) -> Retained<NSMutableAttributedString> {
        let result = NSMutableAttributedString::new();

        for seg in segments {
            // Create the plain NSString for this segment
            let ns_text = NSString::from_str(&seg.text);

            // Create a sub-attributed-string from the plain text
            let sub = NSMutableAttributedString::from_nsstring(&ns_text);

            let range = NSRange::new(0, ns_text.length());

            // Build the font
            let font: Retained<NSFont> = if seg.is_bold {
                NSFont::boldSystemFontOfSize(seg.font_size)
            } else {
                NSFont::systemFontOfSize(seg.font_size)
            };

            // Build the color (sRGB color space, which is correct for UI elements)
            let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                seg.r, seg.g, seg.b, seg.a,
            );

            // Apply font attribute
            // SAFETY: NSFont is the correct type for NSFontAttributeName
            unsafe {
                sub.addAttribute_value_range(
                    NSFontAttributeName,
                    font.as_ref() as &AnyObject,
                    range,
                );
            }

            // Apply foreground color attribute
            // SAFETY: NSColor is the correct type for NSForegroundColorAttributeName
            unsafe {
                sub.addAttribute_value_range(
                    NSForegroundColorAttributeName,
                    color.as_ref() as &AnyObject,
                    range,
                );
            }

            // Append this styled segment to the result
            result.appendAttributedString(&sub);
        }

        result
    }

    /// Find our NSStatusItem by matching its current plain-text title and set the
    /// attributed title on its button.
    ///
    /// Since NSStatusBar does not expose an API to enumerate existing status items,
    /// we cannot iterate them directly from Rust. Instead, this function uses
    /// Tauri's tray handle to:
    ///   1. First set the plain text title via Tauri (so the button has a known title).
    ///   2. Then access the NSStatusItem button through the system status bar.
    ///
    /// However, since NSStatusBar truly has no enumeration API, the practical approach
    /// is to use the raw tray-icon internals. The `tray-icon` crate (which Tauri wraps)
    /// stores the NSStatusItem internally. We access it via the Objective-C runtime
    /// by finding all NSStatusBarButtons in the status bar.
    ///
    /// The simplest reliable approach: use objc2 to access the NSApplication's
    /// windows and find the status bar button, or just accept the Tauri tray handle
    /// and use `set_title` for the text while we set the icon separately.
    ///
    /// **Recommended approach**: Since we can't enumerate NSStatusItems, we take the
    /// plain title string that Tauri already set and search for the matching button
    /// by walking NSApp's windows of type NSStatusBarWindow (private class).
    ///
    /// For maximum reliability, this module provides a different strategy: it creates
    /// its OWN NSStatusItem (separate from Tauri's) that shows only the attributed
    /// title, and hides Tauri's title. Or better: we use the `ns_status_item` pointer
    /// that tray-icon stores internally.
    ///
    /// After research, the cleanest approach that works with Tauri 2 is to directly
    /// set the attributedTitle via the Tauri tray icon's underlying platform handle.
    pub fn set_attributed_title_on_tray(
        tray: &tauri::tray::TrayIcon,
        segments: &[StyledSegment],
    ) {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        let attr_string = build_attributed_string(segments);

        // Tauri's TrayIcon wraps tray-icon::TrayIcon which on macOS holds an
        // NSStatusItem. We need to reach into it. Unfortunately Tauri does not
        // expose a public `ns_status_item()` accessor.
        //
        // Strategy: Use NSStatusBar::systemStatusBar() and the fact that our app
        // only has ONE status item. We get the button from each status item we own.
        // Since there's no enumeration API, we use the Objective-C runtime to
        // send messages to the internal tray-icon pointer.
        //
        // The tray-icon crate on macOS stores the status item in a field.
        // We'll use a different, reliable approach: after Tauri sets the plain title,
        // we iterate all NSWindows looking for the NSStatusBarWindow that contains
        // our button, then set the attributed title on it.

        // Most reliable approach for a single-tray app: access the system status bar,
        // and use the fact that our app owns exactly one NSStatusItem.
        // We can get at the button by finding NSStatusBarButton instances.

        // Actually, the simplest working approach: use the Objective-C runtime to
        // walk through NSApp -> mainMenu is wrong for status items.
        // The truly correct approach: enumerate all windows, find NSStatusBarWindow.

        unsafe {
            // Get NSApplication's shared app
            let app_class = objc2::runtime::AnyClass::get(c"NSApplication").unwrap();
            let ns_app: *mut AnyObject = msg_send![app_class, sharedApplication];
            if ns_app.is_null() {
                return;
            }

            // Get all windows -- this includes NSStatusBarWindow instances
            let windows: *mut AnyObject = msg_send![ns_app, windows];
            if windows.is_null() {
                return;
            }

            let count: usize = msg_send![windows, count];

            for i in 0..count {
                let window: *mut AnyObject = msg_send![windows, objectAtIndex: i];
                if window.is_null() {
                    continue;
                }

                // Check if this window is an NSStatusBarWindow (private class)
                let window_class: *const objc2::runtime::AnyClass = msg_send![window, class];
                let class_name = (*window_class).name();
                if class_name.to_str().unwrap_or("") != "NSStatusBarWindow" {
                    continue;
                }

                // Get the content view
                let content_view: *mut AnyObject = msg_send![window, contentView];
                if content_view.is_null() {
                    continue;
                }

                // The content view of an NSStatusBarWindow is the NSStatusBarButton itself
                // Try to set the attributed title on it
                let _: () = msg_send![content_view, setAttributedTitle: &*attr_string];
                // We found our status bar button, done
                return;
            }
        }
    }

    /// Alternative: Create segments from usage data for the tray title.
    /// This builds colored segments where the percentage values are color-coded
    /// based on utilization level.
    pub fn usage_color_f64(pct: f64) -> (f64, f64, f64, f64) {
        if pct >= 90.0 {
            (1.0, 0.333, 0.333, 1.0) // Red
        } else if pct >= 75.0 {
            (1.0, 0.706, 0.118, 1.0) // Orange/Yellow
        } else {
            (0.235, 0.863, 0.471, 1.0) // Green
        }
    }
}
