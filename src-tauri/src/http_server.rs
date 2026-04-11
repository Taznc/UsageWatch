use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::{Any, CorsLayer};

use crate::polling::UsageUpdate;

#[derive(Clone)]
struct ServerState {
    latest_usage: Arc<Mutex<Option<UsageUpdate>>>,
    app_handle: AppHandle,
}

pub fn start(app_handle: AppHandle, latest_usage: Arc<Mutex<Option<UsageUpdate>>>) {
    let state = ServerState {
        latest_usage,
        app_handle,
    };

    tauri::async_runtime::spawn(async move {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let router = Router::new()
            .route("/api/usage", get(get_usage))
            .route("/api/open", post(open_window))
            .layer(cors)
            .with_state(state);

        match tokio::net::TcpListener::bind("127.0.0.1:52700").await {
            Ok(listener) => {
                eprintln!("[UsageWatch] Stream Deck API listening on http://127.0.0.1:52700");
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[UsageWatch] HTTP server error: {e}");
                }
            }
            Err(e) => {
                eprintln!("[UsageWatch] Stream Deck HTTP server could not bind to port 52700: {e}");
                eprintln!("[UsageWatch] Stream Deck integration will be unavailable.");
            }
        }
    });
}

async fn get_usage(
    State(s): State<ServerState>,
) -> Result<Json<UsageUpdate>, StatusCode> {
    match s.latest_usage.lock().unwrap().clone() {
        Some(update) => Ok(Json(update)),
        None => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn open_window(State(s): State<ServerState>) -> StatusCode {
    match s.app_handle.get_webview_window("main") {
        Some(window) => {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = s.app_handle.emit("window-opened", ());
            StatusCode::OK
        }
        None => StatusCode::SERVICE_UNAVAILABLE,
    }
}
