use rdev::{listen, Event, EventType};
use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};
use tauri::{Emitter, Listener, WebviewWindow};

/// Window position in physical pixels, updated whenever the window moves.
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
    // Seed the initial position
    update_window_geometry(&window);

    // Update stored position whenever the window moves or resizes
    let w1 = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                update_window_geometry(&w1);
            }
            _ => {}
        }
    });

    // Also listen for the custom event that the frontend emits after layout-driven resizes
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

                // Quick reject: skip emit entirely if cursor is far from the window
                // (adds generous 80px margin for DPI scaling fuzz)
                if x < wx - 80.0 || x > wx + ww + 80.0 || y < wy - 80.0 || y > wy + wh + 80.0 {
                    // Still emit a sentinel so the frontend can set ignore=true
                    let _ = emitter.emit("device-mouse-move", MousePos { x: -9999.0, y: -9999.0 });
                    return;
                }

                // Emit window-local coordinates (physical pixels).
                // The frontend divides by devicePixelRatio to get CSS pixels,
                // matching getBoundingClientRect() which is viewport-relative.
                let _ = emitter.emit(
                    "device-mouse-move",
                    MousePos {
                        x: x - wx,
                        y: y - wy,
                    },
                );
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("[widget_hook] rdev error: {error:?}");
        }
    });
}
