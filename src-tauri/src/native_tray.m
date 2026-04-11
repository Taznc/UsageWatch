#import <AppKit/AppKit.h>

typedef struct {
    const char *text;
    float r, g, b, a;
    float font_size;
    int is_bold;
} TraySegment;

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

    // Apply on main thread (AppKit requirement)
    NSMutableAttributedString *captured = [result copy];
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                for (NSWindow *window in [NSApp windows]) {
                    if (![NSStringFromClass([window class]) isEqualToString:@"NSStatusBarWindow"])
                        continue;

                    // The contentView is NSStatusBarContentView.
                    // The button is a subview of it, or accessible via the
                    // window's private _statusItem property.
                    NSView *contentView = [window contentView];
                    if (!contentView) continue;

                    // Try to get the status item from the window
                    NSStatusItem *statusItem = nil;
                    @try {
                        statusItem = [window valueForKey:@"_statusItem"];
                    } @catch (NSException *e) {
                        // Fall through to subview search
                    }

                    if (statusItem) {
                        NSStatusBarButton *button = statusItem.button;
                        if (button && button.title.length > 0) {
                            [button setAttributedTitle:captured];
                            return;
                        }
                    }

                    // Fallback: search subviews for NSStatusBarButton
                    for (NSView *subview in contentView.subviews) {
                        if ([subview isKindOfClass:[NSButton class]]) {
                            NSButton *button = (NSButton *)subview;
                            if (button.title.length > 0) {
                                [button setAttributedTitle:captured];
                                return;
                            }
                        }
                    }
                }
            } @catch (NSException *e) {
                NSLog(@"[styled_tray] Exception: %@", e);
            }
        }
    });
}
