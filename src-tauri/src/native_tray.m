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
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(100 * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;

                // Save the current button frame (set by Tauri's set_title)
                NSRect savedFrame = button.frame;

                // Set the styled title
                [button setAttributedTitle:captured];

                // Restore the original frame so the TrayTarget overlay stays valid
                [button setFrame:savedFrame];

                // Also resize all subviews (TrayTarget overlay) to match
                for (NSView *subview in button.subviews) {
                    [subview setFrame:button.bounds];
                    // Update tracking areas
                    for (NSTrackingArea *area in [subview.trackingAreas copy]) {
                        [subview removeTrackingArea:area];
                        NSTrackingArea *newArea = [[NSTrackingArea alloc]
                            initWithRect:button.bounds
                                 options:area.options
                                   owner:area.owner
                                userInfo:area.userInfo];
                        [subview addTrackingArea:newArea];
                    }
                }
            } @catch (NSException *e) {
                NSLog(@"[styled_tray] Exception: %@", e);
            }
        }
    });
}
