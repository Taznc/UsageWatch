# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

UsageWatch is a tray-first macOS Tauri 2.x app with a React + TypeScript frontend and Rust backend.

- The shipped product name and bundle metadata still use `Claude Usage Tracker`.
- The app monitors Claude usage directly from `claude.ai`.
- It also detects Codex auth, polls Codex usage, and can switch tray rendering based on the frontmost app.
- Cursor is supported for auth detection and provider switching, but there is no Cursor usage polling yet.

## Build & Run

```bash
npm run tauri dev
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
```

Notes:

- Vite serves on port `1420` and uses a separate HMR port `1421` in Tauri dev.
- The frontend is multi-page: `index.html` for the main popover and `widget/index.html` for the widget window.
- Rust must come from `rustup`; if the shell cannot find cargo, source `~/.cargo/env`.

## Repo-Local Claude Config

The repo contains `.claude`, but it is config, not a skill library.

- `.claude/launch.json` defines local launch targets for `npm run tauri dev` and `npm run dev`.
- `.claude/settings.local.json` grants local Claude tooling access to web search and bash.
- There is no repo-local `.claude/commands`, `.claude/agents`, or skill folder to load.

## Architecture

### Runtime model

- The app is tray-first: no dock icon, hidden main window, popover shown under the tray icon on left click.
- A second frameless `widget` window is defined in `src-tauri/tauri.conf.json`.
- On macOS, the tray can render styled text and switch the displayed provider based on the frontmost app.
- A local HTTP server exposes the latest Claude usage for Stream Deck integrations.

### Backend (`src-tauri/src/`)

- `lib.rs` wires plugins, windows, tray/menu behavior, provider-aware tray state, focus monitoring, HTTP server startup, and both polling loops.
- `commands/credentials.rs` persists `session_key` and `org_id` in `tauri-plugin-store` and hydrates the in-memory cache on startup.
- `commands/usage.rs` fetches Claude usage, raw usage JSON, billing endpoints, and Anthropic system status.
- `commands/browser.rs` scans installed browsers plus Claude Desktop cookie stores for `sessionKey`.
- `commands/codex.rs` reads `~/.codex/auth.json` or `$CODEX_HOME/auth.json`, refreshes OpenAI OAuth tokens when stale, and polls Codex usage from `chatgpt.com`.
- `commands/cursor.rs` checks Cursor auth state from the VS Code-style `globalStorage/storage.json` file and returns the cached email/path.
- `polling.rs` runs separate Claude and Codex polling tasks and emits `usage-update` and `codex-update`.
- `http_server.rs` runs an Axum server on `127.0.0.1:52700` with `/api/usage` and `/api/open`.
- `credentials_cache.rs` avoids repeated store reads by keeping session/org values in memory.
- `models.rs` holds resilient Claude response types plus frontend-ready Codex/tray/provider models.
- `tray_state.rs` decides which provider to render and pushes styled/native tray updates.
- `tray_renderer.rs` contains countdown/title formatting helpers.
- `focus_monitor.rs` watches the frontmost macOS application and triggers tray refreshes.
- `styled_tray.rs` and `native_tray.m` implement the macOS custom tray image/title bridge.

### Frontend (`src/`)

- `App.tsx` mounts the app provider, checks whether credentials exist, and routes between setup, settings, and popover views.
- `context/AppContext.tsx` stores Claude data, Codex data, settings, view state, and offline/loading flags.
- `hooks/useUsageData.ts` listens for Rust events, handles manual refresh, and tracks online/offline state.
- `hooks/useHistoryRecorder.ts` writes Claude usage snapshots into SQLite.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts` derive burn-rate and native alert behavior from stored history/current usage.
- `components/SetupWizard.tsx` supports browser auto-detect and manual session key entry.
- `components/Settings.tsx` manages Claude credentials, tray format, provider mappings, alerts, autostart/polling, debug info, and Codex/Cursor connection checks.
- `components/Popover.tsx` renders Claude and Codex tabs, billing, history, pin behavior, and refresh/settings actions.
- `components/DebugPanel.tsx`, `HistoryChart.tsx`, `StatusIndicator.tsx`, and `UsageBar.tsx` support diagnostics and visualization.

### Widget frontend (`src/widget/` + `src/context/WidgetContext.tsx` + `src/hooks/useWidget*.ts`)

- `widget/WidgetApp.tsx` is the widget entrypoint.
- `WidgetWindow.tsx` restores position, auto-resizes via `ResizeObserver`, and persists movement.
- `useWidgetData.ts` listens for Claude/Codex events and fetches usage, billing, and status immediately on mount.
- `useWidgetStore.ts` stores layout state under `widget_layout` in the same `credentials.json` store file.
- `WidgetGrid.tsx`, `WidgetHeader.tsx`, `TilePalette.tsx`, and `widget/tiles/*` implement the drag-and-drop widget surface.

## Communication Pattern

- Rust emits `usage-update`, `codex-update`, `refresh-requested`, `open-settings`, and `window-opened`.
- The main React app listens to those events with `@tauri-apps/api/event`.
- The frontend calls Rust commands through `invoke()`.
- Widget and main window share the same backend event stream.

## Persistence

- `tauri-plugin-store` file: `credentials.json`
- Stored keys include Claude credentials, tray format, tray config, alert config, and widget layout.
- Usage history lives in `sqlite:usage_history.db` via `tauri-plugin-sql`.
- The SQL migration currently creates a single `usage_history` table for Claude data snapshots.

## External APIs and Inputs

### Claude

Authenticated with `cookie: sessionKey={key}` against `claude.ai`:

- `/api/organizations`
- `/api/organizations/{org_id}/usage`
- `/api/organizations/{org_id}/prepaid/credits`
- `/api/organizations/{org_id}/overage_credit_grant`
- `/api/organizations/{org_id}/prepaid/bundles`

Important response fields:

- `utilization`
- `resets_at`
- money values are minor units / cents

### Codex

- OAuth refresh endpoint: `https://auth.openai.com/oauth/token`
- Usage endpoint: `https://chatgpt.com/backend-api/wham/usage`
- Auth source: `~/.codex/auth.json` unless `$CODEX_HOME` overrides it

### Other

- Anthropic status: `https://status.anthropic.com/api/v2/status.json`
- Local Stream Deck API: `http://127.0.0.1:52700/api/usage` and `POST /api/open`
- Browser import uses `rookie` to read browser cookie stores.
- Cursor auth is file-based only; no Cursor API fetch exists yet.

## Key Design Decisions

- No macOS keychain for Claude credentials; persistence uses `tauri-plugin-store`.
- Credentials are copied into an in-memory cache at startup to avoid repeated store I/O.
- Claude and Codex poll independently; both refresh the tray after each update.
- The menu bar can be static or dynamic by provider, using app/bundle mappings from settings.
- The widget and main window intentionally consume the same shared usage events.
- Parsing is defensive: most Claude API fields are optional with `#[serde(default)]`.

## macOS Tray Behavior

The custom tray renderer is fragile by nature. Preserve these invariants:

- `lib.rs` uses `.show_menu_on_left_click(false)`.
- Left click is handled manually in `on_tray_icon_event`.
- Right click depends on the native tray bridge replaying the menu popup manually.
- `tray.with_inner_tray_icon(...)` must pass the real `NSStatusItem` into `styled_tray::register_native_status_item(...)`.
- `native_tray.m` must keep Tauri's `TaoTrayTarget` above custom content after redraws.

If tray clicks regress:

- Check launch logs for the native tray registration path.
- Check for `[tray]` click logs from `lib.rs`.
- Verify `ensureSubviewCoverage(...)` is still restoring `TaoTrayTarget`.

## Tauri Plugins

- `notification`
- `autostart`
- `sql`
- `store`
- `opener`
