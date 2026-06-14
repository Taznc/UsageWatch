#import <AppKit/AppKit.h>
#include <string.h>

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
    if ([tooltip isEqualToString:@"UsageWatch"]) {
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

// Capture whatever NSMenu is currently attached to the status item and detach
// it, so left-clicks flow through normal NSView routing to TaoTrayTarget instead
// of being swallowed by the system status-bar menu interception.
//
// Safe to call repeatedly. A runtime [NSStatusItem setMenu:] (e.g. from
// rebuild_tray_menu when the account list or widget-checkmark changes) RE-ATTACHES
// a menu, which silently re-enables the interception. Calling this again
// re-captures the fresh menu (so right-click still shows the up-to-date items)
// and detaches it again. If nothing is attached, the previously cached menu is
// preserved.
static void captureAndDetachMenu(void) {
    if (!cachedStatusItem) return;
    NSMenu *attached = cachedStatusItem.menu;
    if (attached) {
        cachedMenu = attached;
        cachedStatusItem.menu = nil;
    }
}

// Register the secondary-click event monitors exactly once. They read the static
// cachedMenu at click time, so they automatically pick up a menu swapped in later
// by captureAndDetachMenu().
static void registerSecondaryClickMonitorsOnce(NSStatusBarButton *button) {
    if (clickHandlingSetup) return;
    clickHandlingSetup = YES;

    // Secondary-click monitor: open the menu on mouse-down to match native status item behavior.
    [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskRightMouseDown | NSEventMaskLeftMouseDown)
                                          handler:^NSEvent *(NSEvent *event) {
        BOOL isRightClick = event.type == NSEventTypeRightMouseDown;
        BOOL isControlClick = event.type == NSEventTypeLeftMouseDown
            && (event.modifierFlags & NSEventModifierFlagControl) == NSEventModifierFlagControl;
        if (!isRightClick && !isControlClick) return event;
        if (!cachedMenu) return event;

        NSPoint screenPt = [NSEvent mouseLocation];
        if (!button.window) return event;
        NSRect btnScreen = [button.window
            convertRectToScreen:[button convertRect:button.bounds toView:nil]];

        if (!NSPointInRect(screenPt, btnScreen)) return event;

        // Pop the menu at the cursor's screen position (nil view = screen coords).
        suppressNextSecondaryMouseUp = YES;
        [cachedMenu popUpMenuPositioningItem:nil atLocation:screenPt inView:nil];
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

static void setupClickHandling(NSStatusBarButton *button) {
    captureAndDetachMenu();
    registerSecondaryClickMonitorsOnce(button);
}

// Called from Rust immediately after [TrayIcon setMenu:] re-attaches a menu to
// the status item (rebuild_tray_menu). Re-detaches the freshly attached menu so
// left-click keeps reaching TaoTrayTarget (the popover/widget toggle) instead of
// being intercepted by the system as a menu trigger. Without this, toggling the
// widget or switching accounts would break left-click on the tray icon.
__attribute__((used))
__attribute__((visibility("default")))
void resync_tray_menu(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;
                captureAndDetachMenu();
                registerSecondaryClickMonitorsOnce(button);
            } @catch (NSException *e) {
                NSLog(@"[UsageWatch] Exception in resync_tray_menu: %@", e);
            }
        }
    });
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

__attribute__((used))
__attribute__((visibility("default")))
void set_styled_tray_title_with_icon(const TraySegment *segments, int count, const uint8_t *icon_data, int icon_len) {
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
    NSAttributedString *capturedAttr = [attrStr copy];

    // Create provider icon from embedded bytes
    NSImage *providerIcon = nil;
    if (icon_data != NULL && icon_len > 0) {
        NSData *data = [NSData dataWithBytes:icon_data length:(NSUInteger)icon_len];
        providerIcon = [[NSImage alloc] initWithData:data];
    }
    NSImage *capturedIcon = providerIcon;

    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;

                setupClickHandling(button);
                registerFrameObserverIfNeeded(button);

                CGFloat barHeight = [[NSStatusBar systemStatusBar] thickness];
                NSSize  textSize  = [capturedAttr size];
                CGFloat iconPt    = (capturedIcon != nil) ? 16.0 : 0.0;
                CGFloat iconGap   = (capturedIcon != nil) ? 4.0  : 0.0;
                CGFloat hPad      = 4.0;
                CGFloat totalW    = hPad + iconPt + iconGap + textSize.width + hPad;
                NSSize  imgSize   = NSMakeSize(totalW, barHeight);

                NSImage *image = [NSImage imageWithSize:imgSize
                                               flipped:NO
                                        drawingHandler:^BOOL(NSRect dstRect) {
                    // Draw provider icon
                    if (capturedIcon) {
                        CGFloat yOff = (dstRect.size.height - iconPt) / 2.0;
                        NSRect iconRect = NSMakeRect(hPad, yOff, iconPt, iconPt);
                        [capturedIcon drawInRect:iconRect
                                       fromRect:NSZeroRect
                                      operation:NSCompositingOperationSourceOver
                                       fraction:1.0
                                 respectFlipped:YES
                                           hints:nil];
                    }
                    // Draw text
                    CGFloat xText = hPad + iconPt + iconGap;
                    CGFloat yText = (dstRect.size.height - textSize.height) / 2.0;
                    [capturedAttr drawInRect:NSMakeRect(xText, yText, textSize.width, textSize.height)];
                    return YES;
                }];
                image.template = NO;

                [button setImage:image];
                [button setImagePosition:NSImageOnly];
                [button setTitle:@""];

                ensureSubviewCoverage(button);

            } @catch (NSException *e) {
                NSLog(@"[UsageWatch] Exception in set_styled_tray_title_with_icon: %@", e);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Stacked (two-row) styled tray rendering
//
// Draws the session line on top and the weekly line on the bottom, with the
// provider icon vertically centered across both rows.
//
// Key fact (verified on-device): a status-button image does NOT get scaled to
// the 22pt NSStatusBar thickness — the button grows to fit a taller image (up
// to the ~37-39pt notched menu-bar window). So we size the image to the actual
// usable menu-bar height and scale the font to match, giving two large, clearly
// separated lines on notched Macs while degrading gracefully (~24pt → smaller
// font) on standard displays.
//
// Tray text has NO descenders (S/W/digits/%/d/h/m/$/"now"), so we pack the two
// lines by their baselines (capHeight) rather than full line boxes.
// ---------------------------------------------------------------------------

// Build a row's attributed string at a fixed point size (overriding any size
// carried on the segments — the native layer owns stacked sizing). Keeps each
// segment's color and bold flag.
static NSAttributedString *buildRowAttrString(const TraySegment *segs, int count, CGFloat pointSize) {
    NSMutableAttributedString *attrStr = [[NSMutableAttributedString alloc] init];
    for (int i = 0; i < count; i++) {
        NSString *text = [NSString stringWithUTF8String:segs[i].text];
        if (!text) continue;

        // Monospaced (tabular) digits: every digit is the same width, so the
        // tray doesn't shift as countdowns tick and the two rows' numbers align.
        NSFont *font = [NSFont monospacedDigitSystemFontOfSize:pointSize
                                                        weight:(segs[i].is_bold ? NSFontWeightBold : NSFontWeightRegular)];
        NSColor *color = [NSColor colorWithSRGBRed:segs[i].r
                                             green:segs[i].g
                                              blue:segs[i].b
                                             alpha:segs[i].a];
        [attrStr appendAttributedString:[[NSAttributedString alloc]
            initWithString:text
                attributes:@{NSFontAttributeName: font,
                             NSForegroundColorAttributeName: color}]];
    }
    return [attrStr copy];
}

__attribute__((used))
__attribute__((visibility("default")))
void set_styled_tray_title_stacked(const TraySegment *topSegs, int topCount,
                                   const TraySegment *botSegs, int botCount,
                                   const uint8_t *icon_data, int icon_len) {
    if (topCount == 0 && botCount == 0) return;

    // Usable menu-bar height = the top inset between the full screen frame and
    // its visibleFrame (the menu-bar band). ~39pt on a notched MacBook, ~24pt on
    // a standard display. Falls back to the classic 22pt thickness.
    CGFloat menuBarH = 22.0;
    NSScreen *scr = [NSScreen mainScreen];
    if (scr) {
        CGFloat topInset = NSMaxY(scr.frame) - NSMaxY(scr.visibleFrame);
        if (topInset > menuBarH) menuBarH = topInset;
    }
    CGFloat H = menuBarH - 2.0;          // small inset so glyphs don't touch edges
    if (H < 22.0) H = 22.0;
    if (H > 38.0) H = 38.0;

    // Font scaled to the available height (two stacked lines).
    CGFloat rowSize = round(H * 0.43);
    if (rowSize < 9.0)  rowSize = 9.0;
    if (rowSize > 16.0) rowSize = 16.0;

    NSFont *rowFont = [NSFont monospacedDigitSystemFontOfSize:rowSize weight:NSFontWeightRegular];
    CGFloat cap = rowFont.capHeight;
    CGFloat asc = rowFont.ascender;

    // Even vertical rhythm: top margin == inter-line gap == bottom margin, i.e.
    // gap = (H - 2*cap)/3. Without this, a fixed small gap leaves the two lines
    // clustered in the middle with big empty margins — which reads as squished.
    CGFloat gap = (H - 2.0 * cap) / 3.0;
    if (gap < 3.0) gap = 3.0;
    if (gap > 6.0) gap = 6.0;

    // Build rows + measure synchronously while the Rust-owned segment pointers
    // are still valid (they are freed once this call returns; the async block
    // below must NOT touch topSegs/botSegs).
    NSAttributedString *topAttr = buildRowAttrString(topSegs, topCount, rowSize);
    NSAttributedString *botAttr = buildRowAttrString(botSegs, botCount, rowSize);

    // Column alignment: each row is "<label>\t<value columns>". A single left
    // tab stop placed just past the widest label makes the value columns start
    // at the same x on every row — so S vs W (different glyph widths) no longer
    // shift the percent/timer columns out of alignment. Combined with the
    // figure-space percent padding (Rust side), all three columns line up.
    // Rows are "\t<label>\t<values>". The label sits BETWEEN the first and
    // second tab; the values follow the last tab. Measure both columns.
    CGFloat labelW = 0.0, afterW = 0.0;
    for (NSAttributedString *row in @[topAttr, botAttr]) {
        NSString *s = row.string;
        NSRange first = [s rangeOfString:@"\t"];
        if (first.location != NSNotFound) {
            NSRange second = [s rangeOfString:@"\t"
                                      options:0
                                        range:NSMakeRange(first.location + 1, s.length - first.location - 1)];
            if (second.location != NSNotFound) {
                CGFloat lw = [[row attributedSubstringFromRange:NSMakeRange(first.location + 1, second.location - first.location - 1)] size].width;
                if (lw > labelW) labelW = lw;
            }
            NSRange last = [s rangeOfString:@"\t" options:NSBackwardsSearch];
            NSUInteger start = last.location + last.length;
            CGFloat aw = [[row attributedSubstringFromRange:NSMakeRange(start, row.length - start)] size].width;
            if (aw > afterW) afterW = aw;
        } else {
            CGFloat w = [row size].width;
            if (w > afterW) afterW = w;
        }
    }
    CGFloat colGap = round(rowSize * 0.30);
    CGFloat valueX = labelW + colGap;

    // Right-align the label to labelW (so S and W share a right edge and have a
    // uniform gap to the values), then left-align the value columns at valueX.
    NSMutableParagraphStyle *ps = [[NSMutableParagraphStyle alloc] init];
    ps.tabStops = @[[[NSTextTab alloc] initWithType:NSRightTabStopType location:labelW],
                    [[NSTextTab alloc] initWithType:NSLeftTabStopType location:valueX]];
    ps.defaultTabInterval = valueX;
    NSMutableAttributedString *topM = [topAttr mutableCopy];
    NSMutableAttributedString *botM = [botAttr mutableCopy];
    if (topM.length) [topM addAttribute:NSParagraphStyleAttributeName value:ps range:NSMakeRange(0, topM.length)];
    if (botM.length) [botM addAttribute:NSParagraphStyleAttributeName value:ps range:NSMakeRange(0, botM.length)];

    CGFloat lineH = [topAttr size].height;   // natural line height (tabs don't change it)
    CGFloat textW = valueX + afterW;          // robust width including the tab gap

    NSImage *providerIcon = nil;
    if (icon_data != NULL && icon_len > 0) {
        NSData *data = [NSData dataWithBytes:icon_data length:(NSUInteger)icon_len];
        providerIcon = [[NSImage alloc] initWithData:data];
    }
    NSImage *capturedIcon = providerIcon;

    CGFloat iconPt  = (capturedIcon != nil) ? MIN(round(H * 0.5), 18.0) : 0.0;
    CGFloat iconGap = (capturedIcon != nil) ? 3.0 : 0.0;
    CGFloat hPad    = 3.0;
    CGFloat totalW  = hPad + iconPt + iconGap + textW + hPad;
    NSSize  imgSize = NSMakeSize(totalW, H);

    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSStatusBarButton *button = findOurButton();
                if (!button) return;

                setupClickHandling(button);
                registerFrameObserverIfNeeded(button);

                NSImage *image = [NSImage imageWithSize:imgSize
                                               flipped:NO
                                        drawingHandler:^BOOL(NSRect dstRect) {
                    CGFloat drawH = dstRect.size.height;

                    // Provider icon: vertically centered across both rows.
                    if (capturedIcon) {
                        CGFloat yOff = (drawH - iconPt) / 2.0;
                        NSRect iconRect = NSMakeRect(hPad, yOff, iconPt, iconPt);
                        [capturedIcon drawInRect:iconRect
                                        fromRect:NSZeroRect
                                       operation:NSCompositingOperationSourceOver
                                        fraction:1.0
                                  respectFlipped:YES
                                           hints:nil];
                    }

                    CGFloat xText = hPad + iconPt + iconGap;
                    // Center the two-line block (2*cap + gap) vertically. No
                    // descenders, so packing by capHeight never clips the bottom.
                    CGFloat blockInk = 2.0 * cap + gap;
                    CGFloat bottomBaseline = (drawH - blockInk) / 2.0;
                    CGFloat topBaseline = bottomBaseline + cap + gap;
                    // drawInRect (flipped:NO) top-aligns the single line, so its
                    // baseline lands at rect.y + lineHeight - ascender; solve for
                    // rect.y. (Verified on-device — do NOT change to baseline-asc.)
                    CGFloat topRectY = topBaseline - lineH + asc;
                    CGFloat botRectY = bottomBaseline - lineH + asc;
                    [topM drawInRect:NSMakeRect(xText, topRectY, textW, lineH)];
                    [botM drawInRect:NSMakeRect(xText, botRectY, textW, lineH)];
                    return YES;
                }];
                image.template = NO;

                [button setImage:image];
                [button setImagePosition:NSImageOnly];
                [button setTitle:@""];

                ensureSubviewCoverage(button);

            } @catch (NSException *e) {
                NSLog(@"[UsageWatch] Exception in set_styled_tray_title_stacked: %@", e);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Global mouse monitor (replaces rdev on macOS to avoid TSM thread assertion)
// ---------------------------------------------------------------------------

static void (*g_mouse_move_cb)(double, double) = NULL;
static id g_mouse_monitor = nil;

__attribute__((used))
__attribute__((visibility("default")))
void register_mouse_move_callback(void (*cb)(double x, double y)) {
    g_mouse_move_cb = cb;
}

__attribute__((used))
__attribute__((visibility("default")))
void start_native_mouse_monitor(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (g_mouse_monitor) return;
        // Include dragged variants so widget drag (mouse held) also fires.
        NSEventMask mask = NSEventMaskMouseMoved
            | NSEventMaskLeftMouseDragged
            | NSEventMaskRightMouseDragged
            | NSEventMaskOtherMouseDragged;
        g_mouse_monitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mask
                                                                 handler:^(NSEvent *__unused event) {
            if (!g_mouse_move_cb) return;
            NSPoint loc = [NSEvent mouseLocation];
            NSScreen *screen = [NSScreen mainScreen];
            if (!screen) return;
            // Convert Cocoa coords (bottom-left, logical pts) → physical px (top-left)
            double scl  = screen.backingScaleFactor;
            double phys_x = loc.x * scl;
            double phys_y = (screen.frame.size.height - loc.y) * scl;
            g_mouse_move_cb(phys_x, phys_y);
        }];
    });
}

// ---------------------------------------------------------------------------
// Widget drag monitor
//
// performWindowDragWithEvent: starts a native move loop without requiring
// the window to be key.  We restrict it to the header rect (stored via
// set_widget_drag_rect) so only header clicks initiate drag — not card clicks
// that slip through during the brief setIgnoreCursorEvents transition window.
//
// Coordinate note: event.locationInWindow uses AppKit coords (bottom-left
// origin, logical pts).  g_widget_drag_rect is stored in CSS/viewport coords
// (top-left origin).  We convert with cssY = windowHeight - appkitY.
// ---------------------------------------------------------------------------

static CGRect g_widget_drag_rect = {0, 0, 0, 0};

__attribute__((used))
__attribute__((visibility("default")))
void set_widget_drag_rect(float x, float y, float w, float h) {
    // Called from Rust whenever the header hitbox changes (on layout/resize).
    // Values are in CSS logical pixels (top-left origin, post-scale visual bounds).
    g_widget_drag_rect = CGRectMake(x, y, w, h);
}

__attribute__((used))
__attribute__((visibility("default")))
void start_widget_drag_monitor(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        static BOOL monitorStarted = NO;
        if (monitorStarted) return;
        monitorStarted = YES;

        [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                             handler:^NSEvent *(NSEvent *event) {
            NSWindow *win = event.window;
            if (!win) return event;
            if (![win.title isEqualToString:@"UsageWatch Widget"]) return event;

            // Convert AppKit window coords (bottom-left) to CSS coords (top-left).
            NSPoint loc = event.locationInWindow;
            CGFloat winH = win.contentView.frame.size.height;
            CGFloat cssX = loc.x;
            CGFloat cssY = winH - loc.y;

            if (!CGRectContainsPoint(g_widget_drag_rect, CGPointMake(cssX, cssY))) {
                return event; // outside header — let click through normally
            }

            [win performWindowDragWithEvent:event];
            return nil; // consume: suppress focus-acquisition
        }];
    });
}

// ---------------------------------------------------------------------------
// Focus observation (KVO on NSWorkspace.frontmostApplication)
// ---------------------------------------------------------------------------

#import <ApplicationServices/ApplicationServices.h>

static void (*g_focus_callback)(const char *, const char *) = NULL;

@interface FocusObserver : NSObject
@end

@implementation FocusObserver

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey,id> *)change
                       context:(void *)context
{
    if (!g_focus_callback) return;
    NSRunningApplication *app = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!app) return;
    const char *bid  = app.bundleIdentifier ? [app.bundleIdentifier UTF8String] : "";
    const char *name = app.localizedName    ? [app.localizedName UTF8String]    : "";
    g_focus_callback(bid, name);
}

@end

static FocusObserver *g_observer = nil;

__attribute__((used))
__attribute__((visibility("default")))
void register_focus_callback(void (*callback)(const char *, const char *)) {
    g_focus_callback = callback;
}

__attribute__((used))
__attribute__((visibility("default")))
void start_focus_observation(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (g_observer) return;
        g_observer = [[FocusObserver alloc] init];
        [[NSWorkspace sharedWorkspace] addObserver:g_observer
                                        forKeyPath:@"frontmostApplication"
                                           options:NSKeyValueObservingOptionNew
                                           context:NULL];
    });
}

// ---------------------------------------------------------------------------
// Running apps list (for settings UI)
// ---------------------------------------------------------------------------

typedef struct {
    const char *bundle_id;
    const char *name;
} CRunningApp;

__attribute__((used))
__attribute__((visibility("default")))
int get_running_gui_apps(CRunningApp **out_apps) {
    @autoreleasepool {
        NSArray<NSRunningApplication *> *apps =
            [[NSWorkspace sharedWorkspace] runningApplications];

        // Filter to regular GUI apps (activationPolicy == NSApplicationActivationPolicyRegular)
        NSMutableArray<NSRunningApplication *> *guiApps = [NSMutableArray array];
        for (NSRunningApplication *app in apps) {
            if (app.activationPolicy == NSApplicationActivationPolicyRegular) {
                [guiApps addObject:app];
            }
        }

        int count = (int)guiApps.count;
        CRunningApp *result = (CRunningApp *)malloc(count * sizeof(CRunningApp));

        for (int i = 0; i < count; i++) {
            NSRunningApplication *app = guiApps[i];
            result[i].bundle_id = app.bundleIdentifier ? strdup([app.bundleIdentifier UTF8String]) : strdup("");
            result[i].name = app.localizedName ? strdup([app.localizedName UTF8String]) : strdup("");
        }

        *out_apps = result;
        return count;
    }
}

__attribute__((used))
__attribute__((visibility("default")))
void free_running_apps(CRunningApp *apps, int count) {
    for (int i = 0; i < count; i++) {
        free((void *)apps[i].bundle_id);
        free((void *)apps[i].name);
    }
    free(apps);
}

// ---------------------------------------------------------------------------
// Accessibility permission helpers
// ---------------------------------------------------------------------------

__attribute__((used))
__attribute__((visibility("default")))
bool check_accessibility_trusted(void) {
    return AXIsProcessTrusted();
}

__attribute__((used))
__attribute__((visibility("default")))
bool request_accessibility_access(void) {
    // Prompts the user via System Settings; returns current trust status.
    NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
}

// ---------------------------------------------------------------------------
// Window title polling via AXUIElement
// ---------------------------------------------------------------------------

static void (*g_title_callback)(const char *) = NULL;
static NSTimer  *g_title_timer = nil;
static NSString *g_last_title  = nil;

static NSString *ax_frontmost_window_title(void) {
    NSRunningApplication *app = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!app) return nil;

    AXUIElementRef appRef = AXUIElementCreateApplication(app.processIdentifier);
    if (!appRef) return nil;

    CFTypeRef windowRef = NULL;
    AXError err = AXUIElementCopyAttributeValue(appRef, kAXFocusedWindowAttribute, &windowRef);
    CFRelease(appRef);
    if (err != kAXErrorSuccess || !windowRef) return nil;

    CFTypeRef titleRef = NULL;
    err = AXUIElementCopyAttributeValue((AXUIElementRef)windowRef, kAXTitleAttribute, &titleRef);
    CFRelease(windowRef);
    if (err != kAXErrorSuccess || !titleRef) return nil;

    NSString *title = [NSString stringWithString:(__bridge_transfer NSString *)titleRef];
    return title;
}

__attribute__((used))
__attribute__((visibility("default")))
void register_title_callback(void (*callback)(const char *)) {
    g_title_callback = callback;
}

__attribute__((used))
__attribute__((visibility("default")))
void start_title_polling(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (g_title_timer) return;
        g_title_timer = [NSTimer scheduledTimerWithTimeInterval:0.5
                                                        repeats:YES
                                                          block:^(NSTimer *__unused t) {
            if (!g_title_callback || !AXIsProcessTrusted()) return;
            NSString *title   = ax_frontmost_window_title() ?: @"";
            NSString *lastStr = g_last_title ?: @"";
            if (![title isEqualToString:lastStr]) {
                g_last_title = title;
                g_title_callback([title UTF8String]);
            }
        }];
    });
}

__attribute__((used))
__attribute__((visibility("default")))
void stop_title_polling(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [g_title_timer invalidate];
        g_title_timer = nil;
        g_last_title  = nil;
    });
}
