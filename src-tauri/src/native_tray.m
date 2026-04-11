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
    // Get the button's current font BEFORE building the attributed string
    // We'll use this exact font for all segments so the button doesn't resize
    NSStatusBarButton *button = nil;

    if ([NSThread isMainThread]) {
        button = findOurButton();
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{});
        // Can't access button from bg thread, will get it in the dispatch block
    }

    // Build the full plain text to know total length
    NSMutableString *plainText = [NSMutableString string];
    for (int i = 0; i < count; i++) {
        NSString *text = [NSString stringWithUTF8String:segments[i].text];
        if (text) [plainText appendString:text];
    }

    // Build segment ranges and colors
    typedef struct {
        NSUInteger location;
        NSUInteger length;
        float r, g, b, a;
    } ColorRange;

    ColorRange *ranges = malloc(sizeof(ColorRange) * count);
    NSUInteger offset = 0;
    for (int i = 0; i < count; i++) {
        NSString *text = [NSString stringWithUTF8String:segments[i].text];
        NSUInteger len = text ? text.length : 0;
        ranges[i] = (ColorRange){ offset, len, segments[i].r, segments[i].g, segments[i].b, segments[i].a };
        offset += len;
    }

    int capturedCount = count;

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *btn = findOurButton();
                if (!btn) { free(ranges); return; }

                // Get the button's CURRENT attributed title (set by Tauri's set_title)
                NSAttributedString *current = [btn attributedTitle];
                if (!current || current.length == 0) { free(ranges); return; }

                // Create a mutable copy — same text, same font, same size
                NSMutableAttributedString *styled = [current mutableCopy];

                // Only change the foreground color for each segment range
                // This preserves the exact font metrics so the button doesn't resize
                for (int i = 0; i < capturedCount; i++) {
                    if (ranges[i].location + ranges[i].length > styled.length) continue;

                    NSColor *color = [NSColor colorWithSRGBRed:ranges[i].r
                                                         green:ranges[i].g
                                                          blue:ranges[i].b
                                                         alpha:ranges[i].a];

                    [styled addAttribute:NSForegroundColorAttributeName
                                   value:color
                                   range:NSMakeRange(ranges[i].location, ranges[i].length)];
                }

                free(ranges);

                // Set the styled version — same font/size, only colors changed
                // Button frame should NOT change
                [btn setAttributedTitle:styled];

            } @catch (NSException *e) {
                free(ranges);
                NSLog(@"[styled_tray] Exception: %@", e);
            }
        }
    });
}
