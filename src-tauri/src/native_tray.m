#import <AppKit/AppKit.h>

typedef struct {
    const char *text;
    float r, g, b, a;
    float font_size;
    int is_bold;
} TraySegment;

static NSStatusBarButton *cachedButton = nil;
static NSStatusItem      *cachedStatusItem = nil;
static NSMenu            *cachedMenu = nil;
static BOOL               clickHandlingSetup = NO;
static BOOL               frameObserverRegistered = NO;
static BOOL               suppressNextSecondaryMouseUp = NO;

static BOOL isOurTrayButton(NSStatusBarButton *button) {
    if (!button) return NO;
    if (!button.window) return NO;

    NSString *tooltip = button.toolTip;
    if ([tooltip isEqualToString:@"Claude Usage Tracker"]) {
        return YES;
    }

    for (NSView *subview in button.subviews) {
        if ([NSStringFromClass([subview class]) isEqualToString:@"TaoTrayTarget"]) {
            return YES;
        }
    }

    return NO;
}

__attribute__((used))
__attribute__((visibility("default")))
void register_tray_status_item(void *statusItemPtr) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSStatusItem *statusItem = (__bridge NSStatusItem *)statusItemPtr;
            if (!statusItem) return;

            cachedStatusItem = statusItem;
            cachedButton = statusItem.button;
            cachedMenu = nil;
            clickHandlingSetup = NO;
            frameObserverRegistered = NO;
        }
    });
}

// ---------------------------------------------------------------------------
// Button discovery
// ---------------------------------------------------------------------------

static NSStatusBarButton *findOurButton(void) {
    if (isOurTrayButton(cachedButton)) {
        return cachedButton;
    }

    cachedButton = nil;
    cachedStatusItem = nil;

    for (NSWindow *window in [NSApp windows]) {
        if (![NSStringFromClass([window class]) isEqualToString:@"NSStatusBarWindow"])
            continue;
        @try {
            NSStatusItem *statusItem = [window valueForKey:@"_statusItem"];
            if (statusItem && isOurTrayButton(statusItem.button)) {
                cachedButton    = statusItem.button;
                cachedStatusItem = statusItem;
                return cachedButton;
            }
        } @catch (NSException *e) {}
    }
    return nil;
}

// ---------------------------------------------------------------------------
// TaoTrayTarget frame sync
// ---------------------------------------------------------------------------

static void ensureSubviewCoverage(NSStatusBarButton *button) {
    NSRect bounds = button.bounds;
    NSView *trayTarget = nil;
    for (NSView *subview in button.subviews) {
        subview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        if (!NSEqualRects(subview.frame, bounds)) {
            [subview setFrame:bounds];
        }
        if ([NSStringFromClass([subview class]) isEqualToString:@"TaoTrayTarget"]) {
            trayTarget = subview;
        }
    }

    if (trayTarget) {
        [trayTarget removeFromSuperview];
        [button addSubview:trayTarget positioned:NSWindowAbove relativeTo:nil];
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
        ensureSubviewCoverage((NSStatusBarButton *)note.object);
    }];
}

// ---------------------------------------------------------------------------
// Click handling fix
//
// On macOS 14+, [NSStatusItem setMenu:] causes the status bar system to
// intercept ALL mouse events before they reach NSView hit-testing, so
// TaoTrayTarget.mouseDown: is never called.  We fix this by:
//   1. Detaching the NSMenu from the NSStatusItem (kills the interception).
//   2. Registering a local event monitor for right-click that pops the menu
//      manually.  Left-click now flows through normal NSView routing to
//      TaoTrayTarget → mouseUp: → Rust on_tray_icon_event.
// ---------------------------------------------------------------------------

static void setupClickHandling(NSStatusBarButton *button) {
    if (clickHandlingSetup) return;
    clickHandlingSetup = YES;

    // Grab and detach the menu.
    cachedMenu = cachedStatusItem.menu;
    cachedStatusItem.menu = nil;

    NSLog(@"[UsageWatch] Click fix: detached menu from NSStatusItem (was %@)",
          cachedMenu ? @"set" : @"nil");

    if (!cachedMenu) return;

    // Secondary-click monitor: open the menu on mouse-down to match native status item behavior.
    [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskRightMouseDown | NSEventMaskLeftMouseDown)
                                          handler:^NSEvent *(NSEvent *event) {
        BOOL isRightClick = event.type == NSEventTypeRightMouseDown;
        BOOL isControlClick = event.type == NSEventTypeLeftMouseDown
            && (event.modifierFlags & NSEventModifierFlagControl) == NSEventModifierFlagControl;
        if (!isRightClick && !isControlClick) return event;

        NSPoint screenPt = [NSEvent mouseLocation];
        if (!button.window) return event;
        NSRect btnScreen = [button.window
            convertRectToScreen:[button convertRect:button.bounds toView:nil]];

        if (!NSPointInRect(screenPt, btnScreen)) return event;

        // Use AppKit's contextual menu API so the menu opens at the native click location.
        suppressNextSecondaryMouseUp = YES;
        [NSMenu popUpContextMenu:cachedMenu withEvent:event forView:button];
        return nil; // consume so TaoTrayTarget doesn't also try performClick
    }];

    [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskRightMouseUp | NSEventMaskLeftMouseUp)
                                          handler:^NSEvent *(NSEvent *event) {
        if (!suppressNextSecondaryMouseUp) return event;

        BOOL isRightClick = event.type == NSEventTypeRightMouseUp;
        BOOL isControlClick = event.type == NSEventTypeLeftMouseUp
            && (event.modifierFlags & NSEventModifierFlagControl) == NSEventModifierFlagControl;
        if (!isRightClick && !isControlClick) return event;

        suppressNextSecondaryMouseUp = NO;
        return nil;
    }];
}

// ---------------------------------------------------------------------------
// Styled tray rendering (NSImage, retina-aware)
// ---------------------------------------------------------------------------

__attribute__((used))
__attribute__((visibility("default")))
void set_styled_tray_title(const TraySegment *segments, int count) {
    if (count == 0) return;

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
                attributes:@{NSFontAttributeName: font,
                             NSForegroundColorAttributeName: color}]];
    }

    if (attrStr.length == 0) return;
    NSAttributedString *captured = [attrStr copy];

    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;

                // One-time setup: detach menu + register right-click monitor.
                setupClickHandling(button);
                registerFrameObserverIfNeeded(button);

                // Render colored text into an NSImage (retina-aware).
                CGFloat barHeight = [[NSStatusBar systemStatusBar] thickness];
                NSSize  textSize  = [captured size];
                CGFloat hPad      = 4.0;
                NSSize  imgSize   = NSMakeSize(textSize.width + hPad * 2.0, barHeight);

                NSImage *image = [NSImage imageWithSize:imgSize
                                               flipped:NO
                                        drawingHandler:^BOOL(NSRect dstRect) {
                    CGFloat yOff = (dstRect.size.height - textSize.height) / 2.0;
                    [captured drawInRect:NSMakeRect(hPad, yOff,
                                                    dstRect.size.width - hPad * 2.0,
                                                    textSize.height)];
                    return YES;
                }];
                image.template = NO; // preserve our custom colors

                [button setImage:image];
                [button setImagePosition:NSImageOnly];
                [button setTitle:@""];

                ensureSubviewCoverage(button);

            } @catch (NSException *e) {
                NSLog(@"[UsageWatch] Exception: %@", e);
            }
        }
    });
}
