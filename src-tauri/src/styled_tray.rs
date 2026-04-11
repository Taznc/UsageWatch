#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
        NSStatusBar,
    };
    use objc2_foundation::{NSMutableAttributedString, NSRange, NSString};

    #[derive(Debug, Clone)]
    pub struct StyledSegment {
        pub text: String,
        pub r: f64,
        pub g: f64,
        pub b: f64,
        pub a: f64,
        pub font_size: f64,
        pub is_bold: bool,
    }

    impl StyledSegment {
        pub fn from_rgba_u8(
            text: &str, r: u8, g: u8, b: u8, a: u8, font_size: f64, is_bold: bool,
        ) -> Self {
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

    fn build_attributed_string(segments: &[StyledSegment]) -> Retained<NSMutableAttributedString> {
        let result = NSMutableAttributedString::new();

        for seg in segments {
            let ns_text = NSString::from_str(&seg.text);
            let sub = NSMutableAttributedString::from_nsstring(&ns_text);
            let range = NSRange::new(0, ns_text.length());

            let font: Retained<NSFont> = if seg.is_bold {
                NSFont::boldSystemFontOfSize(seg.font_size)
            } else {
                NSFont::systemFontOfSize(seg.font_size)
            };

            let color =
                NSColor::colorWithSRGBRed_green_blue_alpha(seg.r, seg.g, seg.b, seg.a);

            unsafe {
                sub.addAttribute_value_range(
                    NSFontAttributeName,
                    font.as_ref() as &AnyObject,
                    range,
                );
                sub.addAttribute_value_range(
                    NSForegroundColorAttributeName,
                    color.as_ref() as &AnyObject,
                    range,
                );
            }

            result.appendAttributedString(&sub);
        }

        result
    }

    /// Set styled attributed title on the tray's NSStatusItem button.
    ///
    /// Uses NSStatusBar to access status items. Since macOS doesn't expose
    /// enumeration of existing items, we access the button through the
    /// status bar's internal item list via the Objective-C runtime.
    pub fn set_attributed_title_on_tray(
        _tray: &tauri::tray::TrayIcon,
        segments: &[StyledSegment],
    ) {
        if segments.is_empty() {
            return;
        }

        let attr_string = build_attributed_string(segments);

        unsafe {
            // Get the system status bar
            let status_bar = NSStatusBar::systemStatusBar();

            // Access the internal _statusItems array via Objective-C runtime
            // This is a private API but stable across macOS versions
            use objc2::msg_send;
            let items: *mut AnyObject = msg_send![&*status_bar, _statusItems];
            if items.is_null() {
                eprintln!("[styled_tray] _statusItems returned null");
                return;
            }

            let count: usize = msg_send![items, count];
            if count == 0 {
                eprintln!("[styled_tray] no status items found");
                return;
            }

            // Find our status item — iterate and look for the one owned by our app
            // For a single-tray app, we take the last item (most recently added)
            for i in (0..count).rev() {
                let item: *mut AnyObject = msg_send![items, objectAtIndex: i];
                if item.is_null() {
                    continue;
                }

                // Get the button from the status item
                let button: *mut AnyObject = msg_send![item, button];
                if button.is_null() {
                    continue;
                }

                // Check if this button has a title (our tray sets one)
                let title: *mut AnyObject = msg_send![button, title];
                if title.is_null() {
                    continue;
                }

                let length: usize = msg_send![title, length];
                if length == 0 {
                    continue;
                }

                // Set the attributed title
                let _: () = msg_send![button, setAttributedTitle: &*attr_string];
                return;
            }

            eprintln!("[styled_tray] could not find our status item button");
        }
    }
}
