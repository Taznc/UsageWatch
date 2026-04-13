# Transparent Overlay Widget: Click-Through + Drag Implementation

This document explains exactly how to implement a transparent always-on-top overlay widget in Tauri 2 that is **click-through by default** (clicks pass to the desktop/apps behind it) while keeping a **draggable header bar**. This is harder than it looks — three independent bugs must all be solved together.

---

## What We're Building

A borderless, transparent overlay window that:
- Floats above all other windows
- Lets mouse clicks pass through to whatever is behind it (cards, charts, etc. are display-only)
- Has a small header bar that captures hover/drag to move the window
- Works correctly at any DPI (100%, 125%, 150%, 200%)
- Works on both macOS and Windows

---

## The Core Mechanism

Tauri 2 exposes `setIgnoreCursorEvents(bool)` on a window. When `true`, the window is fully click-through — the OS routes all mouse events to whatever is behind it. When `false`, the window captures mouse events normally.

The challenge: we need `true` most of the time (cards), but `false` when the cursor is over the draggable header. There is no native per-region API — we have to **poll cursor position** and flip the flag ourselves.

---

## The Three-Bug Root Cause

Before describing the solution, here is why a naive implementation fails:

### Bug 1 — Cards registered as hitboxes

If you track card DOM elements as interactive hitboxes (in addition to the header), the window disables click-through whenever the cursor is over a card. Since cards have no click handlers, the click is absorbed by the transparent window and **never reaches the desktop**. Cards must be excluded from hitbox tracking entirely.

### Bug 2 — Coordinate system mismatch

The global mouse hook (rdev) gives you **screen-level physical pixel coordinates** (e.g., `(1920, 540)` for a cursor in the middle of a 1080p display). `getBoundingClientRect()` gives you **viewport-relative CSS pixel coordinates** (e.g., `(0, 0)` for the top-left of the webview). These are completely different coordinate systems. Comparing them directly means hitboxes never match — everything silently becomes click-through, which looks correct but means drag can never work either.

### Bug 3 — Fixing Bug 2 exposes Bug 1

Once coordinates are converted correctly, the hitbox math works. But if you still have cards in the hitbox list (Bug 1), they now correctly steal focus and swallow clicks.

**All three must be solved together.**

---

## Solution

### Part 1: Tauri Window Configuration

In `tauri.conf.json`, the widget window needs:

```json
{
  "label": "widget",
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "focus": false
}
```

- `transparent: true` — required for a see-through overlay
- `decorations: false` — no title bar, no frame
- `alwaysOnTop: true` — floats above other windows
- `focus: false` — do not steal focus from the user's active app on open

---

### Part 2: Rust — Global Mouse Hook with Coordinate Conversion (`hook.rs`)

rdev's `listen()` callback runs on a dedicated OS thread and cannot access Tauri handles directly. Use atomic globals to share window geometry between the rdev thread and the Tauri event thread.

```rust
use rdev::{listen, Event, EventType};
use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};
use tauri::{Emitter, Listener, WebviewWindow};

// Window geometry in physical pixels — updated whenever window moves/resizes.
static WIN_X: AtomicI32 = AtomicI32::new(0);
static WIN_Y: AtomicI32 = AtomicI32::new(0);
static WIN_W: AtomicI32 = AtomicI32::new(0);
static WIN_H: AtomicI32 = AtomicI32::new(0);

#[derive(Serialize, Clone)]
struct MousePos {
    x: f64,
    y: f64,
}

fn update_window_geometry(window: &WebviewWindow) {
    if let Ok(pos) = window.outer_position() {
        WIN_X.store(pos.x, Ordering::Relaxed);
        WIN_Y.store(pos.y, Ordering::Relaxed);
    }
    if let Ok(size) = window.outer_size() {
        WIN_W.store(size.width as i32, Ordering::Relaxed);
        WIN_H.store(size.height as i32, Ordering::Relaxed);
    }
}

pub fn start_global_mouse_stream(window: WebviewWindow) {
    // Seed initial geometry
    update_window_geometry(&window);

    // Update on OS-level move/resize events
    let w1 = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                update_window_geometry(&w1);
            }
            _ => {}
        }
    });

    // Also update when the frontend emits "widget-geometry-sync"
    // (needed after layout-driven resize via setSize — see Part 3)
    let w2 = window.clone();
    window.listen("widget-geometry-sync", move |_| {
        update_window_geometry(&w2);
    });

    let emitter = window.clone();
    std::thread::spawn(move || {
        let callback = move |event: Event| {
            if let EventType::MouseMove { x, y } = event.event_type {
                let wx = WIN_X.load(Ordering::Relaxed) as f64;
                let wy = WIN_Y.load(Ordering::Relaxed) as f64;
                let ww = WIN_W.load(Ordering::Relaxed) as f64;
                let wh = WIN_H.load(Ordering::Relaxed) as f64;

                // Quick reject: skip expensive emit when cursor is far from the window.
                // 80px margin accounts for DPI scaling fuzz.
                if x < wx - 80.0 || x > wx + ww + 80.0
                    || y < wy - 80.0 || y > wy + wh + 80.0
                {
                    // Emit a sentinel so the frontend can set ignore=true immediately.
                    let _ = emitter.emit("device-mouse-move", MousePos { x: -9999.0, y: -9999.0 });
                    return;
                }

                // KEY: subtract window position to convert screen coords → window-local coords.
                // Both rdev and outer_position() use physical pixels on macOS and Windows,
                // so this subtraction is always valid.
                let _ = emitter.emit(
                    "device-mouse-move",
                    MousePos { x: x - wx, y: y - wy },
                );
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("[widget_hook] rdev error: {error:?}");
        }
    });
}
```

**Key points:**
- `window.outer_position()` → `PhysicalPosition` (physical pixels, same units as rdev)
- `x - wx` converts from screen coordinates to window-local physical pixels
- The sentinel `(-9999, -9999)` ensures the frontend sees the cursor as "outside" the window and enables click-through even when the quick-reject fires
- `AtomicI32` with `Ordering::Relaxed` is sufficient — stale reads are harmless (off by at most one event)

**Cargo dependencies:**
```toml
rdev = "0.5.3"
```

---

### Part 3: Frontend — Coordinate Conversion and Hitbox Logic (`WidgetOverlay.tsx`)

#### The coordinate pipeline

```
rdev screen px  →  subtract window outer_position  →  window-local physical px
                                                               ↓
                                             divide by devicePixelRatio
                                                               ↓
                                             CSS px  ≡  getBoundingClientRect()
```

This is the **only** correct conversion. Do not attempt to do this conversion in TypeScript by fetching window position from Tauri — that adds async latency that causes hitbox lag during drag.

```typescript
type Hitbox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// payload.x / payload.y are window-local physical pixels (from hook.rs).
// Dividing by devicePixelRatio converts to CSS pixels,
// matching getBoundingClientRect() which is viewport-relative CSS px.
function isInHitbox(deviceX: number, deviceY: number, hitbox: Hitbox): boolean {
  const x = deviceX / window.devicePixelRatio;
  const y = deviceY / window.devicePixelRatio;
  return (
    x >= hitbox.left &&
    x <= hitbox.left + hitbox.width &&
    y >= hitbox.top &&
    y <= hitbox.top + hitbox.height
  );
}
```

#### Only the header is a hitbox

This is the critical design decision. Cards are display-only — they show information but must never capture clicks.

```typescript
// CORRECT: only the header bar is tracked
function recalcHitboxes() {
  const next: Hitbox[] = [];
  const header = headerRef.current?.getBoundingClientRect();
  if (header) {
    next.push({
      left: header.left,
      top: header.top,
      width: header.width,
      height: header.height,
    });
  }
  setHitboxes(next);
}

// WRONG: do NOT do this — cards will absorb clicks instead of passing them through
// cardRefs.forEach((ref) => {
//   const rect = ref.current?.getBoundingClientRect();
//   if (rect) next.push({ left: rect.left, top: rect.top, ... });
// });
```

#### The mouse-move listener

```typescript
useEffect(() => {
  if (!tauri) return;

  const unlisten = listen<{ x: number; y: number }>("device-mouse-move", ({ payload }) => {
    const inHeader = hitboxes.some((box) => isInHitbox(payload.x, payload.y, box));
    // Stay interactive while drag is in progress (dragRef.current = true)
    const shouldIgnore = !dragRef.current && !inHeader;
    if (ignoreStateRef.current === shouldIgnore) return; // deduplicate
    ignoreStateRef.current = shouldIgnore;
    getCurrentWindow().setIgnoreCursorEvents(shouldIgnore).catch(() => {});
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}, [hitboxes, tauri]);
```

#### The drag handler

```typescript
const dragRef = useRef(false);
const ignoreStateRef = useRef<boolean | null>(null);

function handleHeaderPointerDown() {
  dragRef.current = true;
  ignoreStateRef.current = false; // allow interaction immediately
  if (!tauri) return;
  getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
  getCurrentWindow().startDragging().catch(() => {
    dragRef.current = false; // reset if drag fails to start
  });
}

// Clean up drag state on any mouse release
useEffect(() => {
  function stopDragging() {
    dragRef.current = false;
  }
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("mouseup", stopDragging);
  window.addEventListener("blur", stopDragging); // window loses focus mid-drag
  return () => {
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("mouseup", stopDragging);
    window.removeEventListener("blur", stopDragging);
  };
}, []);
```

#### Keeping geometry in sync after programmatic resize

When the window resizes itself (e.g., after layout changes), `setSize` is async and the OS move/resize event may fire before the new geometry is committed. Emit `widget-geometry-sync` after `setSize` resolves to force a geometry refresh on the Rust side:

```typescript
// Inside ResizeObserver callback:
getCurrentWindow()
  .setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height)))
  .then(() => emit("widget-geometry-sync")) // <-- keeps Rust atomic cache current
  .catch(() => {});
```

The Rust side picks this up via `window.listen("widget-geometry-sync", ...)` and calls `update_window_geometry()`.

#### Recalculate hitboxes on geometry changes

```typescript
useEffect(() => {
  const root = rootRef.current;
  if (!root) return;

  const observer = new ResizeObserver(() => {
    recalcHitboxes();
    // ... setSize logic above
  });

  observer.observe(root);
  window.addEventListener("resize", recalcHitboxes);
  recalcHitboxes();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", recalcHitboxes);
  };
}, [tauri, visibleCards, theme, density, scale]);
```

Also recalc after window moves (the header's viewport position doesn't change, but it's good practice):

```typescript
useEffect(() => {
  if (!tauri) return;
  const unlistenMove = getCurrentWindow().onMoved(() => {
    if (!dragRef.current) return;
    savePosition(...);
    recalcHitboxes();
  });
  return () => { unlistenMove.then((fn) => fn()); };
}, [savePosition, tauri]);
// Note: do NOT include visibleCards in this dependency array
```

---

## Complete State Diagram

```
Initial state
  → setIgnoreCursorEvents(true)    // click-through on

Cursor moves near window
  ← "device-mouse-move" event from hook.rs

  If cursor over header:
    → setIgnoreCursorEvents(false)  // window captures events

  If cursor NOT over header:
    → setIgnoreCursorEvents(true)   // click-through

User presses pointer on header:
  → dragRef.current = true
  → setIgnoreCursorEvents(false)
  → startDragging()                 // OS handles drag; window follows cursor

User releases pointer:
  → dragRef.current = false
  ← next "device-mouse-move" event re-evaluates cursor position
  → setIgnoreCursorEvents(true or false) based on current position
```

---

## Cross-Platform Notes

| Concern | macOS | Windows |
|---|---|---|
| rdev coordinates | Physical pixels from NSEvent | Physical pixels from Win32 hook |
| `outer_position()` | `PhysicalPosition` (physical px) | `PhysicalPosition` (physical px) |
| Subtraction valid? | Yes | Yes |
| `devicePixelRatio` in webview | Reflects display scale | Reflects display scale |
| rdev permissions | Requires Accessibility permission | No extra permissions needed |

The arithmetic `x - wx` and `deviceX / devicePixelRatio` is identical on both platforms. No platform-specific branches are needed in the coordinate conversion.

---

## Common Mistakes to Avoid

| Mistake | Symptom | Fix |
|---|---|---|
| Cards in hitbox list | Clicks on cards are absorbed; desktop not reached | Only track header in `recalcHitboxes()` |
| Comparing rdev screen coords directly to `getBoundingClientRect()` | Hitboxes never match; everything is click-through; drag never works | Subtract `outer_position()` in Rust, divide by DPR in TypeScript |
| Fetching window position in TypeScript for coordinate conversion | Works at rest, breaks during fast drag (async lag) | Do the subtraction in Rust where it's synchronous |
| Not emitting `widget-geometry-sync` after programmatic `setSize` | Hitbox drift after layout change; header region is offset | Emit the event in `.then()` after `setSize` |
| Not resetting `dragRef` on window `blur` | Window stays non-click-through after drag if mouse released outside | Add `blur` listener to reset `dragRef` |
| Using `setIgnoreCursorEvents(false)` at startup | App is visible but captures all clicks before user touches it | Initialize to `true` (click-through) |

---

## File Checklist

For a new widget window, the files to touch are:

- [ ] `tauri.conf.json` — `transparent`, `decorations: false`, `alwaysOnTop`, `focus: false`
- [ ] `src-tauri/Cargo.toml` — add `rdev = "0.5.3"`
- [ ] `src-tauri/src/hook.rs` — implement `start_global_mouse_stream()` with atomic geometry cache
- [ ] `src-tauri/src/lib.rs` — call `hook::start_global_mouse_stream(widget_window)` at startup
- [ ] `src/widget/WidgetOverlay.tsx` — `isInHitbox`, `recalcHitboxes` (header only), mouse-move listener, drag handler, ResizeObserver with `widget-geometry-sync` emit
