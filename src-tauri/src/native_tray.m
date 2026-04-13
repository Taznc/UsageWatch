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

static void setupClickHandling(NSStatusBarButton *button) {
    if (clickHandlingSetup) return;
    clickHandlingSetup = YES;

    // Grab and detach the menu.
    cachedMenu = cachedStatusItem.menu;
    cachedStatusItem.menu = nil;

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
