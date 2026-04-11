#import <AppKit/AppKit.h>

typedef struct {
    const char *text;
    float r, g, b, a;
    float font_size;
    int is_bold;
} TraySegment;

static NSStatusBarButton *cachedButton = nil;
static NSStatusItem *cachedStatusItem = nil;
static BOOL frameObserverRegistered = NO;

static NSStatusBarButton *findOurButton(void) {
    if (cachedButton) return cachedButton;

    for (NSWindow *window in [NSApp windows]) {
        if (![NSStringFromClass([window class]) isEqualToString:@"NSStatusBarWindow"])
            continue;

        @try {
            NSStatusItem *statusItem = [window valueForKey:@"_statusItem"];
            if (statusItem && statusItem.button) {
                cachedButton = statusItem.button;
                cachedStatusItem = statusItem;
                return cachedButton;
            }
        } @catch (NSException *e) {}
    }
    return nil;
}

// Keeps TaoTrayTarget (tray-icon's event-handling subview) covering the full button.
// autoresizingMask ensures it tracks future automatic resizes.
static void ensureSubviewCoverage(NSStatusBarButton *button) {
    NSRect bounds = button.bounds;
    NSArray *subviews = button.subviews;
    NSLog(@"[UsageWatch] ensureSubviewCoverage: bounds=(%g,%g,%g,%g) subviews=%lu",
          bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height,
          (unsigned long)subviews.count);
    for (NSView *subview in subviews) {
        NSLog(@"[UsageWatch]   subview class=%@ frame=(%g,%g,%g,%g) hidden=%d",
              NSStringFromClass([subview class]),
              subview.frame.origin.x, subview.frame.origin.y,
              subview.frame.size.width, subview.frame.size.height,
              (int)subview.isHidden);
        subview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        if (!NSEqualRects(subview.frame, bounds)) {
            [subview setFrame:bounds];
        }
    }
}

static void registerFrameObserverIfNeeded(NSStatusBarButton *button) {
    if (frameObserverRegistered) return;
    frameObserverRegistered = YES;
    button.postsFrameChangedNotifications = YES;
    [[NSNotificationCenter defaultCenter]
        addObserverForName:NSViewFrameDidChangeNotification
        object:button
        queue:[NSOperationQueue mainQueue]
        usingBlock:^(NSNotification *note) {
            NSStatusBarButton *btn = (NSStatusBarButton *)note.object;
            NSLog(@"[UsageWatch] Button frame changed: (%g,%g,%g,%g)",
                  btn.bounds.origin.x, btn.bounds.origin.y,
                  btn.bounds.size.width, btn.bounds.size.height);
            ensureSubviewCoverage(btn);
        }];
}

void set_styled_tray_title(const TraySegment *segments, int count) {
    if (count == 0) return;

    // Build attributed string using system font (same metrics as plain title).
    NSMutableAttributedString *attrStr = [[NSMutableAttributedString alloc] init];
    CGFloat fontSize = [NSFont systemFontSize];

    for (int i = 0; i < count; i++) {
        NSString *text = [NSString stringWithUTF8String:segments[i].text];
        if (!text) continue;

        NSFont *font = segments[i].is_bold
            ? [NSFont boldSystemFontOfSize:fontSize]
            : [NSFont systemFontOfSize:fontSize];

        NSColor *color = [NSColor colorWithSRGBRed:segments[i].r
                                             green:segments[i].g
                                              blue:segments[i].b
                                             alpha:segments[i].a];

        [attrStr appendAttributedString:[[NSAttributedString alloc]
            initWithString:text
                attributes:@{
                    NSFontAttributeName: font,
                    NSForegroundColorAttributeName: color,
                }]];
    }

    if (attrStr.length == 0) return;
    NSAttributedString *captured = [attrStr copy];

    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) {
                    NSLog(@"[UsageWatch] set_styled_tray_title: button not found");
                    return;
                }

                registerFrameObserverIfNeeded(button);

                // Render colored text into an NSImage (avoids setAttributedTitle:
                // which can disrupt button internals and TaoTrayTarget event routing).
                CGFloat barHeight = [[NSStatusBar systemStatusBar] thickness];
                NSSize textSize = [captured size];
                CGFloat hPad = 4.0;
                NSSize imageSize = NSMakeSize(textSize.width + hPad * 2.0, barHeight);

                NSLog(@"[UsageWatch] Rendering image: text=(%g,%g) bar=%g imageSize=(%g,%g)",
                      textSize.width, textSize.height, barHeight,
                      imageSize.width, imageSize.height);

                // imageWithSize:flipped:drawingHandler: renders at screen scale (retina-aware).
                NSImage *image = [NSImage imageWithSize:imageSize
                                               flipped:NO
                                        drawingHandler:^BOOL(NSRect dstRect) {
                    // Vertically center the text within the bar height.
                    CGFloat yOff = (dstRect.size.height - textSize.height) / 2.0;
                    [captured drawInRect:NSMakeRect(hPad, yOff,
                                                    dstRect.size.width - hPad * 2.0,
                                                    textSize.height)];
                    return YES;
                }];
                // Do NOT set template: we want our custom colors preserved.
                image.template = NO;

                // Replace the button's visual with our rendered image.
                // imagePosition = NSImageOnly: show image only, no title text.
                [button setImage:image];
                [button setImagePosition:NSImageOnly];
                [button setTitle:@""];

                // Log state before sync
                NSLog(@"[UsageWatch] After image set: button bounds=(%g,%g,%g,%g)",
                      button.bounds.origin.x, button.bounds.origin.y,
                      button.bounds.size.width, button.bounds.size.height);

                // Sync TaoTrayTarget to button's current bounds.
                ensureSubviewCoverage(button);

            } @catch (NSException *e) {
                NSLog(@"[UsageWatch] Exception: %@", e);
            }
        }
    });
}
