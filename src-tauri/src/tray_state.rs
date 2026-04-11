//! Global tray state for provider-aware rendering.
//!
//! Stores shared references so both polling loops and the focus-change callback
//! can trigger an immediate tray re-render for the current provider.

use std::sync::{Arc, Mutex, OnceLock};
use tauri::AppHandle;

use crate::models::{CodexUsageData, Provider, TrayConfig, TrayFormat, UsageData};
use crate::polling::{CodexUpdate, UsageUpdate};
use crate::tray_renderer;

pub struct TrayState {
    pub app_handle: AppHandle,
    pub tray_config: Arc<Mutex<TrayConfig>>,
    pub tray_format: Arc<Mutex<TrayFormat>>,
    pub latest_usage: Arc<Mutex<Option<UsageUpdate>>>,
    pub latest_codex: Arc<Mutex<Option<CodexUpdate>>>,
}

static TRAY_STATE: OnceLock<TrayState> = OnceLock::new();

/// Initialize global tray state. Call once during app setup.
pub fn init(state: TrayState) {
    let _ = TRAY_STATE.set(state);
}

/// Called by focus_monitor when the frontmost app changes.
pub fn on_focus_changed() {
    refresh_tray();
}

/// Re-render the tray for the current provider (resolved from config + focus).
pub fn refresh_tray() {
    let Some(state) = TRAY_STATE.get() else { return };

    let config = state.tray_config.lock().unwrap().clone();
    let format = state.tray_format.lock().unwrap().clone();

    let provider = resolve_current_provider(&config);

    let display = match provider {
        Provider::Claude => {
            let lock = state.latest_usage.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_claude)
        }
        Provider::Codex => {
            let lock = state.latest_codex.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_codex)
        }
    };

    if let Some(dd) = display {
        render_tray(&state.app_handle, &dd, &format);
    }
}

fn resolve_current_provider(config: &TrayConfig) -> Provider {
    #[cfg(target_os = "macos")]
    {
        let bid = crate::focus_monitor::current_bundle_id();
        let name = crate::focus_monitor::current_app_name();
        config.resolve_provider(bid.as_deref(), name.as_deref())
    }
    #[cfg(not(target_os = "macos"))]
    {
        match &config.mode {
            crate::models::TrayMode::Static(p) => *p,
            crate::models::TrayMode::Dynamic => config.default_provider,
        }
    }
}

// ── Provider-agnostic tray data ─────────────────────────────────────────────

pub struct TrayDisplayData {
    pub session_pct: Option<f64>,
    pub session_reset: Option<String>,
    pub weekly_pct: Option<f64>,
    pub weekly_reset: Option<String>,
    pub sonnet_pct: Option<f64>,
    pub opus_pct: Option<f64>,
    pub extra_usage_enabled: bool,
    pub extra_used: Option<f64>,
    pub extra_limit: Option<f64>,
}

impl TrayDisplayData {
    pub fn from_claude(data: &UsageData) -> Self {
        Self {
            session_pct: data.five_hour.as_ref().map(|w| w.utilization),
            session_reset: data.five_hour.as_ref().and_then(|w| w.resets_at.clone()),
            weekly_pct: data.seven_day.as_ref().map(|w| w.utilization),
            weekly_reset: data.seven_day.as_ref().and_then(|w| w.resets_at.clone()),
            sonnet_pct: data.seven_day_sonnet.as_ref().map(|w| w.utilization),
            opus_pct: data.seven_day_opus.as_ref().map(|w| w.utilization),
            extra_usage_enabled: data
                .extra_usage
                .as_ref()
                .map(|e| e.is_enabled)
                .unwrap_or(false),
            extra_used: data.extra_usage.as_ref().map(|e| e.used_credits),
            extra_limit: data.extra_usage.as_ref().map(|e| e.monthly_limit),
        }
    }

    pub fn from_codex(data: &CodexUsageData) -> Self {
        Self {
            session_pct: data.session_window.as_ref().map(|w| w.used_percent),
            session_reset: data
                .session_window
                .as_ref()
                .and_then(|w| w.resets_at.clone()),
            weekly_pct: data.weekly_window.as_ref().map(|w| w.used_percent),
            weekly_reset: data
                .weekly_window
                .as_ref()
                .and_then(|w| w.resets_at.clone()),
            sonnet_pct: None,
            opus_pct: None,
            extra_usage_enabled: false,
            extra_used: None,
            extra_limit: None,
        }
    }
}

// ── Rendering ───────────────────────────────────────────────────────────────

fn render_tray(app: &AppHandle, data: &TrayDisplayData, format: &TrayFormat) {
    use tauri::Manager;
    if app.tray_by_id("main-tray").is_none() {
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let segments = build_styled_segments(data, format);
        crate::styled_tray::set_native_styled_title(&segments);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let title = build_plain_title(data, format);
        if let Some(tray) = app.tray_by_id("main-tray") {
            let _ = tray.set_title(Some(&title));
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn build_plain_title(data: &TrayDisplayData, format: &TrayFormat) -> String {
    let mut parts = Vec::new();
    if format.show_session_pct {
        if let Some(pct) = data.session_pct {
            parts.push(format!("S {}%", pct.round() as i32));
        }
    }
    if format.show_weekly_pct {
        if let Some(pct) = data.weekly_pct {
            parts.push(format!("W {}%", pct.round() as i32));
        }
    }
    parts.join(&format.separator)
}

#[cfg(target_os = "macos")]
fn build_styled_segments(
    data: &TrayDisplayData,
    format: &TrayFormat,
) -> Vec<crate::styled_tray::StyledSegment> {
    use crate::styled_tray::StyledSegment;

    let label_color = (185, 185, 200, 255);
    let timer_color = (160, 210, 255, 255);
    let sep_color = (110, 110, 125, 255);

    fn pct_color(pct: f64) -> (u8, u8, u8, u8) {
        if pct >= 90.0 {
            (255, 100, 100, 255)
        } else if pct >= 75.0 {
            (255, 200, 50, 255)
        } else {
            (80, 240, 140, 255)
        }
    }

    let mut groups: Vec<Vec<StyledSegment>> = Vec::new();

    // Session group
    if format.show_session_pct || format.show_session_timer {
        if let Some(pct) = data.session_pct {
            let mut segs = Vec::new();
            if format.show_session_pct {
                let (r, g, b, a) = label_color;
                segs.push(StyledSegment::from_rgba_u8("S ", r, g, b, a, 13.0, false));
                let (r, g, b, a) = pct_color(pct);
                segs.push(StyledSegment::from_rgba_u8(
                    &format!("{}%", pct.round() as i32),
                    r, g, b, a, 13.0, false,
                ));
            }
            if format.show_session_timer {
                if let Some(ref reset) = data.session_reset {
                    let cd = tray_renderer::format_countdown_public(reset);
                    if !cd.is_empty() {
                        let (r, g, b, a) = timer_color;
                        segs.push(StyledSegment::from_rgba_u8(
                            &format!("  {}", cd),
                            r, g, b, a, 13.0, false,
                        ));
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Weekly group
    if format.show_weekly_pct || format.show_weekly_timer {
        if let Some(pct) = data.weekly_pct {
            let mut segs = Vec::new();
            if format.show_weekly_pct {
                let (r, g, b, a) = label_color;
                segs.push(StyledSegment::from_rgba_u8("W ", r, g, b, a, 13.0, false));
                let (r, g, b, a) = pct_color(pct);
                segs.push(StyledSegment::from_rgba_u8(
                    &format!("{}%", pct.round() as i32),
                    r, g, b, a, 13.0, false,
                ));
            }
            if format.show_weekly_timer {
                if let Some(ref reset) = data.weekly_reset {
                    let cd = tray_renderer::format_countdown_public(reset);
                    if !cd.is_empty() {
                        let (r, g, b, a) = timer_color;
                        segs.push(StyledSegment::from_rgba_u8(
                            &format!("  {}", cd),
                            r, g, b, a, 13.0, false,
                        ));
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Sonnet (Claude-only — None for other providers)
    if format.show_sonnet_pct {
        if let Some(pct) = data.sonnet_pct {
            if pct > 0.0 {
                let (r, g, b, a) = label_color;
                let (pr, pg, pb, pa) = pct_color(pct);
                groups.push(vec![
                    StyledSegment::from_rgba_u8("So ", r, g, b, a, 13.0, false),
                    StyledSegment::from_rgba_u8(
                        &format!("{}%", pct.round() as i32),
                        pr, pg, pb, pa, 13.0, false,
                    ),
                ]);
            }
        }
    }

    // Opus (Claude-only)
    if format.show_opus_pct {
        if let Some(pct) = data.opus_pct {
            if pct > 0.0 {
                let (r, g, b, a) = label_color;
                let (pr, pg, pb, pa) = pct_color(pct);
                groups.push(vec![
                    StyledSegment::from_rgba_u8("Op ", r, g, b, a, 13.0, false),
                    StyledSegment::from_rgba_u8(
                        &format!("{}%", pct.round() as i32),
                        pr, pg, pb, pa, 13.0, false,
                    ),
                ]);
            }
        }
    }

    // Extra usage (Claude-only)
    if format.show_extra_usage && data.extra_usage_enabled {
        if let (Some(used), Some(limit)) = (data.extra_used, data.extra_limit) {
            groups.push(vec![StyledSegment::from_rgba_u8(
                &format!(
                    "${}/{}",
                    (used / 100.0).round() as i32,
                    (limit / 100.0).round() as i32
                ),
                139, 92, 246, 255, 13.0, false,
            )]);
        }
    }

    // Flatten groups with separators
    let mut result = Vec::new();
    for (i, group) in groups.iter().enumerate() {
        if i > 0 {
            let (r, g, b, a) = sep_color;
            result.push(StyledSegment::from_rgba_u8(
                &format!("  {}  ", format.separator.trim()),
                r, g, b, a, 13.0, false,
            ));
        }
        result.extend(group.iter().cloned());
    }

    result
}
