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
    // Build the attributed string on the calling thread (data is valid here)
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

    // Dispatch to main thread with a small delay so Tauri's set_title
    // (which also dispatches to main) completes first and updates
    // the TrayTarget dimensions. We then only change the colors/styling
    // without changing the text content or button width.
    NSAttributedString *captured = [result copy];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (button) {
                    [button setAttributedTitle:captured];
                }
            } @catch (NSException *e) {
                NSLog(@"[styled_tray] Exception: %@", e);
            }
        }
    });
}
