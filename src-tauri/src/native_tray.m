#import <AppKit/AppKit.h>

typedef struct {
    const char *text;
    float r, g, b, a;
    float font_size;
    int is_bold;
} TraySegment;

static NSStatusBarButton *cachedButton = nil;

static NSStatusBarButton *findOurButton(void) {
    if (cachedButton) return cachedButton;

    for (NSWindow *window in [NSApp windows]) {
        if (![NSStringFromClass([window class]) isEqualToString:@"NSStatusBarWindow"])
            continue;

        @try {
            NSStatusItem *statusItem = [window valueForKey:@"_statusItem"];
            if (statusItem && statusItem.button) {
                cachedButton = statusItem.button;
                return cachedButton;
            }
        } @catch (NSException *e) {
            // Try next window
        }
    }
    return nil;
}

/// Sync the TrayTarget overlay subview to match the button's current bounds.
/// This must be called after any change to the button's title/attributedTitle
/// because the tray-icon crate's TrayTarget only gets resized by its own
/// set_title/set_icon methods (via update_dimensions).
static void syncTrayTargetFrame(NSStatusBarButton *button) {
    NSRect bounds = button.bounds;
    for (NSView *subview in button.subviews) {
        [subview setFrame:bounds];
        // Rebuild tracking areas to match new bounds
        for (NSTrackingArea *area in [subview.trackingAreas copy]) {
            [subview removeTrackingArea:area];
            NSTrackingArea *newArea = [[NSTrackingArea alloc]
                initWithRect:bounds
                     options:area.options
                       owner:area.owner
                    userInfo:area.userInfo];
            [subview addTrackingArea:newArea];
        }
    }
}

void set_styled_tray_title(const TraySegment *segments, int count) {
    NSMutableAttributedString *result = [[NSMutableAttributedString alloc] init];

    for (int i = 0; i < count; i++) {
        NSString *text = [NSString stringWithUTF8String:segments[i].text];
        if (!text) continue;

        NSFont *font;
        if (segments[i].is_bold) {
            font = [NSFont boldSystemFontOfSize:segments[i].font_size];
        } else {
            font = [NSFont systemFontOfSize:segments[i].font_size];
        }

        NSColor *color = [NSColor colorWithSRGBRed:segments[i].r
                                             green:segments[i].g
                                              blue:segments[i].b
                                             alpha:segments[i].a];

        NSDictionary *attrs = @{
            NSFontAttributeName: font,
            NSForegroundColorAttributeName: color,
        };

        NSAttributedString *seg = [[NSAttributedString alloc] initWithString:text
                                                                  attributes:attrs];
        [result appendAttributedString:seg];
    }

    if (result.length == 0) return;

    NSAttributedString *captured = [result copy];

    // Delay to let Tauri's set_title() and update_dimensions() complete first
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;

                // Set the styled title — this may resize the button
                [button setAttributedTitle:captured];

                // Let the button settle its layout
                [button sizeToFit];

                // Now sync the TrayTarget overlay to match the new size
                syncTrayTargetFrame(button);

            } @catch (NSException *e) {
                NSLog(@"[styled_tray] Exception: %@", e);
            }
        }
    });
}
