#import <AppKit/AppKit.h>

// Struct to receive segment data from Rust
typedef struct {
    const char *text;
    float r, g, b, a;
    float font_size;
    int is_bold;
} TraySegment;

void set_styled_tray_title(const TraySegment *segments, int count) {
    @autoreleasepool {
        @try {
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

            // Find our status item button
            // Walk all status items in the system status bar
            NSStatusBar *bar = [NSStatusBar systemStatusBar];

            // Use KVC to access private _statusItems array
            NSArray *items = nil;
            @try {
                items = [bar valueForKey:@"_statusItems"];
            } @catch (NSException *e) {
                // Fallback: try to find via windows
                for (NSWindow *window in [NSApp windows]) {
                    if ([NSStringFromClass([window class]) isEqualToString:@"NSStatusBarWindow"]) {
                        NSView *contentView = [window contentView];
                        if ([contentView isKindOfClass:[NSButton class]]) {
                            NSButton *button = (NSButton *)contentView;
                            if (button.title.length > 0) {
                                [button setAttributedTitle:result];
                                return;
                            }
                        }
                    }
                }
                return;
            }

            // Find the button with a non-empty title (our tray icon)
            for (NSInteger i = items.count - 1; i >= 0; i--) {
                NSStatusItem *item = items[i];
                NSStatusBarButton *button = item.button;
                if (button && button.title.length > 0) {
                    [button setAttributedTitle:result];
                    return;
                }
            }
        } @catch (NSException *e) {
            NSLog(@"[styled_tray] Exception: %@", e);
        }
    }
}
