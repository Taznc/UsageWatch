//! Global tray state for provider-aware rendering.
//!
//! Stores shared references so both polling loops and the focus-change callback
//! can trigger an immediate tray re-render for the current provider.

use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::models::{
    CodexUsageData, CursorUsageData, Provider, TrayConfig, TrayField, TrayFormat,
    TrayMode, TraySegmentDef, TraySegmentKind, UsageData,
};
use crate::polling::{CodexUpdate, CursorUpdate, UsageUpdate};
#[cfg(target_os = "macos")]
use crate::tray_renderer;

pub struct TrayState {
    pub app_handle: AppHandle,
    pub tray_config: Arc<Mutex<TrayConfig>>,
    pub tray_format: Arc<Mutex<TrayFormat>>,
    pub latest_usage: Arc<Mutex<Option<UsageUpdate>>>,
    pub latest_codex: Arc<Mutex<Option<CodexUpdate>>>,
    pub latest_cursor: Arc<Mutex<Option<CursorUpdate>>>,
}

static TRAY_STATE: OnceLock<TrayState> = OnceLock::new();
static LAST_PROVIDER: OnceLock<Mutex<Option<Provider>>> = OnceLock::new();
static LAST_MATCHED_PROVIDER: OnceLock<Mutex<Option<Provider>>> = OnceLock::new();

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

    // Multi/Static mode: render from segment definitions
    if let Some(segments) = config.effective_segments() {
        let provider = resolve_current_provider(&config);
        emit_provider_change_if_needed(&state.app_handle, provider);
        render_multi_tray(&state.app_handle, state, &segments, &format);
        return;
    }

    // Dynamic mode: single-provider rendering
    let provider = resolve_current_provider(&config);
    emit_provider_change_if_needed(&state.app_handle, provider);

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
        Provider::Cursor => {
            let lock = state.latest_cursor.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_cursor)
        }
    };

    if let Some(dd) = display {
        render_tray(&state.app_handle, &dd, &format);
    }
}

fn emit_provider_change_if_needed(app: &AppHandle, provider: Provider) {
    let state = LAST_PROVIDER.get_or_init(|| Mutex::new(None));
    let mut lock = state.lock().unwrap();
    if *lock != Some(provider) {
        *lock = Some(provider);
        let _ = app.emit("provider-changed", provider);
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn resolve_current_provider(config: &TrayConfig) -> Provider {
    match &config.mode {
        TrayMode::Static(provider) => *provider,
        TrayMode::Multi(segs) => {
            segs.iter()
                .find_map(|s| match &s.kind {
                    TraySegmentKind::ProviderData { provider, .. } => Some(*provider),
                    _ => None,
                })
                .unwrap_or(config.default_provider)
        }
        TrayMode::Dynamic => {
            let bid = crate::focus_monitor::current_bundle_id();
            let name = crate::focus_monitor::current_app_name();
            let title = crate::focus_monitor::current_window_title();

            if let Some(provider) = config.match_provider(bid.as_deref(), name.as_deref(), title.as_deref()) {
                let state = LAST_MATCHED_PROVIDER.get_or_init(|| Mutex::new(None));
                if let Ok(mut lock) = state.lock() {
                    *lock = Some(provider);
                }
                provider
            } else {
                let state = LAST_MATCHED_PROVIDER.get_or_init(|| Mutex::new(None));
                state
                    .lock()
                    .ok()
                    .and_then(|lock| *lock)
                    .unwrap_or(config.default_provider)
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn resolve_current_provider(config: &TrayConfig) -> Provider {
    match &config.mode {
        TrayMode::Static(p) => *p,
        TrayMode::Multi(segs) => {
            segs.iter()
                .find_map(|s| match &s.kind {
                    TraySegmentKind::ProviderData { provider, .. } => Some(*provider),
                    _ => None,
                })
                .unwrap_or(config.default_provider)
        }
        TrayMode::Dynamic => config.default_provider,
    }
}

pub fn current_provider() -> Option<Provider> {
    let state = TRAY_STATE.get()?;
    let config = state.tray_config.lock().ok()?.clone();
    Some(resolve_current_provider(&config))
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

    pub fn from_cursor(data: &CursorUsageData) -> Self {
        Self {
            session_pct: Some(data.spend_pct),
            session_reset: data.cycle_resets_at.clone(),
            weekly_pct: None,
            weekly_reset: None,
            sonnet_pct: None,
            opus_pct: None,
            extra_usage_enabled: true,
            extra_used: Some(data.current_spend_cents),
            extra_limit: Some(data.limit_cents),
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
            #[cfg(target_os = "windows")]
            {
                let _ = tray.set_title(Option::<&str>::None);
                let _ = tray.set_tooltip(Some(&title));
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = tray.set_title(Some(&title));
            }
        }
    }
}

// ── Multi-provider rendering ───────────────────────────────────────────────

/// Cached display data for all providers, used by multi-provider rendering.
struct MultiDisplayCache {
    claude: Option<TrayDisplayData>,
    codex: Option<TrayDisplayData>,
    cursor: Option<TrayDisplayData>,
}

impl MultiDisplayCache {
    fn get(&self, provider: &Provider) -> Option<&TrayDisplayData> {
        match provider {
            Provider::Claude => self.claude.as_ref(),
            Provider::Codex => self.codex.as_ref(),
            Provider::Cursor => self.cursor.as_ref(),
        }
    }
}

fn render_multi_tray(
    app: &AppHandle,
    state: &TrayState,
    segments: &[TraySegmentDef],
    format: &TrayFormat,
) {
    if app.tray_by_id("main-tray").is_none() {
        return;
    }

    let cache = MultiDisplayCache {
        claude: {
            let lock = state.latest_usage.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_claude)
        },
        codex: {
            let lock = state.latest_codex.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_codex)
        },
        cursor: {
            let lock = state.latest_cursor.lock().unwrap();
            lock.as_ref()
                .and_then(|u| u.data.as_ref())
                .map(TrayDisplayData::from_cursor)
        },
    };

    #[cfg(target_os = "macos")]
    {
        let styled = build_multi_styled_segments(segments, format, &cache);
        crate::styled_tray::set_native_styled_title(&styled);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let title = build_multi_plain_title(segments, format, &cache);
        if let Some(tray) = app.tray_by_id("main-tray") {
            #[cfg(target_os = "windows")]
            {
                let _ = tray.set_title(Option::<&str>::None);
                let _ = tray.set_tooltip(Some(&title));
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = tray.set_title(Some(&title));
            }
        }
    }
}

/// Resolve a single segment field to a plain-text string.
#[cfg(not(target_os = "macos"))]
fn resolve_field_plain(
    field: &TrayField,
    data: Option<&TrayDisplayData>,
) -> Option<String> {
    let dd = data?;
    match field {
        TrayField::SessionPct => dd.session_pct.map(|p| format!("S {}%", p.round() as i32)),
        TrayField::SessionTimer => dd.session_reset.as_ref().and_then(|r| {
            let cd = crate::tray_renderer::format_countdown_public(r);
            if cd.is_empty() { None } else { Some(format!("S {}", cd)) }
        }),
        TrayField::WeeklyPct => dd.weekly_pct.map(|p| format!("W {}%", p.round() as i32)),
        TrayField::WeeklyTimer => dd.weekly_reset.as_ref().and_then(|r| {
            let cd = crate::tray_renderer::format_countdown_public(r);
            if cd.is_empty() { None } else { Some(format!("W {}", cd)) }
        }),
        TrayField::SonnetPct => dd.sonnet_pct.filter(|&p| p > 0.0).map(|p| format!("So {}%", p.round() as i32)),
        TrayField::OpusPct => dd.opus_pct.filter(|&p| p > 0.0).map(|p| format!("Op {}%", p.round() as i32)),
        TrayField::ExtraUsage => {
            if dd.extra_usage_enabled {
                if let (Some(used), Some(limit)) = (dd.extra_used, dd.extra_limit) {
                    return Some(format!(
                        "${}/{}",
                        (used / 100.0).round() as i32,
                        (limit / 100.0).round() as i32
                    ));
                }
            }
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn build_multi_plain_title(
    segments: &[TraySegmentDef],
    format: &TrayFormat,
    cache: &MultiDisplayCache,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut last_provider: Option<Provider> = None;

    for seg in segments {
        match &seg.kind {
            TraySegmentKind::ProviderData { provider, field } => {
                if let Some(text) = resolve_field_plain(field, cache.get(provider)) {
                    let needs_emoji = last_provider != Some(*provider);
                    if needs_emoji {
                        parts.push(format!("{} {}", provider.emoji(), text));
                    } else {
                        parts.push(text);
                    }
                    last_provider = Some(*provider);
                }
            }
            TraySegmentKind::CustomText { text } => {
                parts.push(text.clone());
                last_provider = None;
            }
        }
    }

    if parts.is_empty() {
        "--".to_string()
    } else {
        parts.join(&format.separator)
    }
}

#[cfg(target_os = "macos")]
fn build_multi_styled_segments(
    segments: &[TraySegmentDef],
    format: &TrayFormat,
    cache: &MultiDisplayCache,
) -> Vec<crate::styled_tray::StyledSegment> {
    use crate::styled_tray::StyledSegment;

    let label_color = (185, 185, 200, 255);
    let timer_color = (160, 210, 255, 255);
    let sep_color = (110, 110, 125, 255);
    let custom_color = (200, 200, 220, 255);

    let mut groups: Vec<Vec<StyledSegment>> = Vec::new();
    let mut last_provider: Option<Provider> = None;

    for seg in segments {
        match &seg.kind {
            TraySegmentKind::ProviderData { provider, field } => {
                let dd = cache.get(provider);
                if let Some(segs) = resolve_field_styled(field, dd, label_color, timer_color) {
                    let mut group = Vec::new();
                    if last_provider != Some(*provider) {
                        group.push(StyledSegment::from_rgba_u8(
                            &format!("{} ", provider.emoji()),
                            255, 255, 255, 255, 13.0, false,
                        ));
                    }
                    group.extend(segs);
                    groups.push(group);
                    last_provider = Some(*provider);
                }
            }
            TraySegmentKind::CustomText { text } => {
                let (r, g, b, a) = custom_color;
                groups.push(vec![StyledSegment::from_rgba_u8(text, r, g, b, a, 13.0, false)]);
                last_provider = None;
            }
        }
    }

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

#[cfg(target_os = "macos")]
fn resolve_field_styled(
    field: &TrayField,
    data: Option<&TrayDisplayData>,
    label_color: (u8, u8, u8, u8),
    timer_color: (u8, u8, u8, u8),
) -> Option<Vec<crate::styled_tray::StyledSegment>> {
    use crate::styled_tray::StyledSegment;

    fn pct_color(pct: f64) -> (u8, u8, u8, u8) {
        if pct >= 90.0 {
            (255, 100, 100, 255)
        } else if pct >= 75.0 {
            (255, 200, 50, 255)
        } else {
            (80, 240, 140, 255)
        }
    }

    let dd = data?;
    match field {
        TrayField::SessionPct => {
            let pct = dd.session_pct?;
            let (r, g, b, a) = label_color;
            let (pr, pg, pb, pa) = pct_color(pct);
            Some(vec![
                StyledSegment::from_rgba_u8("S ", r, g, b, a, 13.0, false),
                StyledSegment::from_rgba_u8(&format!("{}%", pct.round() as i32), pr, pg, pb, pa, 13.0, false),
            ])
        }
        TrayField::SessionTimer => {
            let reset = dd.session_reset.as_ref()?;
            let cd = crate::tray_renderer::format_countdown_public(reset);
            if cd.is_empty() { return None; }
            let (r, g, b, a) = timer_color;
            Some(vec![StyledSegment::from_rgba_u8(&cd, r, g, b, a, 13.0, false)])
        }
        TrayField::WeeklyPct => {
            let pct = dd.weekly_pct?;
            let (r, g, b, a) = label_color;
            let (pr, pg, pb, pa) = pct_color(pct);
            Some(vec![
                StyledSegment::from_rgba_u8("W ", r, g, b, a, 13.0, false),
                StyledSegment::from_rgba_u8(&format!("{}%", pct.round() as i32), pr, pg, pb, pa, 13.0, false),
            ])
        }
        TrayField::WeeklyTimer => {
            let reset = dd.weekly_reset.as_ref()?;
            let cd = crate::tray_renderer::format_countdown_public(reset);
            if cd.is_empty() { return None; }
            let (r, g, b, a) = timer_color;
            Some(vec![StyledSegment::from_rgba_u8(&cd, r, g, b, a, 13.0, false)])
        }
        TrayField::SonnetPct => {
            let pct = dd.sonnet_pct.filter(|&p| p > 0.0)?;
            let (r, g, b, a) = label_color;
            let (pr, pg, pb, pa) = pct_color(pct);
            Some(vec![
                StyledSegment::from_rgba_u8("So ", r, g, b, a, 13.0, false),
                StyledSegment::from_rgba_u8(&format!("{}%", pct.round() as i32), pr, pg, pb, pa, 13.0, false),
            ])
        }
        TrayField::OpusPct => {
            let pct = dd.opus_pct.filter(|&p| p > 0.0)?;
            let (r, g, b, a) = label_color;
            let (pr, pg, pb, pa) = pct_color(pct);
            Some(vec![
                StyledSegment::from_rgba_u8("Op ", r, g, b, a, 13.0, false),
                StyledSegment::from_rgba_u8(&format!("{}%", pct.round() as i32), pr, pg, pb, pa, 13.0, false),
            ])
        }
        TrayField::ExtraUsage => {
            if !dd.extra_usage_enabled { return None; }
            let used = dd.extra_used?;
            let limit = dd.extra_limit?;
            Some(vec![StyledSegment::from_rgba_u8(
                &format!("${}/{}", (used / 100.0).round() as i32, (limit / 100.0).round() as i32),
                139, 92, 246, 255, 13.0, false,
            )])
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
    if format.show_session_timer {
        if let Some(ref reset) = data.session_reset {
            let cd = crate::tray_renderer::format_countdown_public(reset);
            if !cd.is_empty() {
                parts.push(format!("S {}", cd));
            }
        }
    }
    if format.show_weekly_pct {
        if let Some(pct) = data.weekly_pct {
            parts.push(format!("W {}%", pct.round() as i32));
        }
    }
    if format.show_weekly_timer {
        if let Some(ref reset) = data.weekly_reset {
            let cd = crate::tray_renderer::format_countdown_public(reset);
            if !cd.is_empty() {
                parts.push(format!("W {}", cd));
            }
        }
    }
    if format.show_sonnet_pct {
        if let Some(pct) = data.sonnet_pct {
            if pct > 0.0 {
                parts.push(format!("So {}%", pct.round() as i32));
            }
        }
    }
    if format.show_opus_pct {
        if let Some(pct) = data.opus_pct {
            if pct > 0.0 {
                parts.push(format!("Op {}%", pct.round() as i32));
            }
        }
    }
    if format.show_extra_usage && data.extra_usage_enabled {
        if let (Some(used), Some(limit)) = (data.extra_used, data.extra_limit) {
            parts.push(format!(
                "${}/{}",
                (used / 100.0).round() as i32,
                (limit / 100.0).round() as i32
            ));
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
