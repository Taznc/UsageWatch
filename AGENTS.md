# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

UsageWatch is a cross-provider, tray-first app (Tauri 2.x + React + TypeScript) that monitors usage limits across supported AI providers.

- The shipped product name and bundle metadata still use `Claude Usage Tracker`.
- The app monitors Claude usage directly from `claude.ai`.
- It also detects Codex auth, polls Codex usage, and can switch tray rendering based on the frontmost app.
- Cursor is supported for auth detection, provider switching, and usage polling (manual token or pulled session).

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
- A local HTTP server exposes the latest Claude, Codex, and Cursor snapshots for Stream Deck and similar integrations.

### Backend (`src-tauri/src/`)

- `lib.rs` wires plugins, windows, tray/menu behavior, provider-aware tray state, focus monitoring, HTTP server startup, unified usage polling, and the `refresh_all_providers` command.
- `commands/credentials.rs` persists `session_key` and `org_id` in `tauri-plugin-store` and hydrates the in-memory cache on startup.
- `commands/usage.rs` fetches Claude usage, raw usage JSON, billing endpoints, and Anthropic system status.
- `commands/browser.rs` scans installed browsers plus Claude Desktop cookie stores for `sessionKey`.
- `commands/codex.rs` reads `~/.codex/auth.json` or `$CODEX_HOME/auth.json`, refreshes OpenAI OAuth tokens when stale, and polls Codex usage from `chatgpt.com`.
- `commands/cursor.rs` reads Cursor `globalStorage` (`storage.json` or Windows `state.vscdb`), resolves auth, and fetches usage from Cursor’s HTTP APIs when a token is available.
- `polling.rs` runs a **single** background loop (`start_unified_polling`): on each tick it fetches Claude, Codex, and Cursor **in parallel** (`tokio::join!` via `poll_all_providers`), updates shared caches, emits events, and refreshes the tray. After a short boot delay (~400ms) it runs an immediate first poll, then repeats on the user-configured interval (`poll_interval_secs`, minimum 30s).
- `http_server.rs` runs an Axum server on `127.0.0.1:52700` with `GET /api/usage`, `GET /api/codex`, `GET /api/cursor`, and `POST /api/open`.
- `credentials_cache.rs` avoids repeated store reads by keeping session/org values in memory.
- `models.rs` holds resilient Claude response types plus frontend-ready Codex/Cursor/tray/provider models.
- `tray_state.rs` decides which provider to render and pushes styled/native tray updates.
- `tray_renderer.rs` contains countdown/title formatting helpers.
- `focus_monitor.rs` watches the frontmost macOS application and triggers tray refreshes.
- `styled_tray.rs` and `native_tray.m` implement the macOS custom tray image/title bridge.

### Frontend (`src/`)

- `App.tsx` mounts the app provider, checks whether credentials exist, and routes between setup, settings, and popover views.
- `context/AppContext.tsx` stores Claude, Codex, and Cursor data, settings, view state, and offline/loading flags.
- `hooks/useUsageData.ts` listens for Rust events, calls `refresh_all_providers` for manual refresh (popover / UI), and tracks online/offline state.
- `hooks/useHistoryRecorder.ts` writes Claude usage snapshots into SQLite.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts` derive burn-rate and native alert behavior from stored history/current usage.
- `components/SetupWizard.tsx` supports browser auto-detect and manual session key entry.
- `components/Settings.tsx` manages Claude credentials, tray format, provider mappings, alerts, autostart/polling, debug info, and Codex/Cursor connection checks.
- `components/Popover.tsx` renders Claude, Codex, and Cursor tabs (when configured), billing, history, pin behavior, and refresh/settings actions.
- `components/DebugPanel.tsx`, `HistoryChart.tsx`, `StatusIndicator.tsx`, and `UsageBar.tsx` support diagnostics and visualization.

### Widget frontend (`src/widget/` + `src/context/WidgetContext.tsx` + `src/hooks/useWidget*.ts`)

- `widget/WidgetApp.tsx` is the widget entrypoint (mounts `WidgetOverlay`).
- `widget/WidgetOverlay.tsx` implements glass-style deck/ticker UI, click-through, header drag, and window auto-resize.
- `widget/selectors.ts` and `widget/WidgetCard.tsx` build and render usage cards from shared app state.
- `useWidgetData.ts` listens for Claude/Codex/Cursor events and primes from `get_latest_*_update` plus supplemental billing/status fetches on mount.
- `useWidgetStore.ts` persists `widget_layout` in `credentials.json` (see `widget/layout.ts`).

## Communication Pattern

- Rust emits `usage-update` (Claude), `codex-update`, `cursor-update`, `provider-changed`, `open-settings`, and `window-opened`.
- Tray **Refresh** runs `poll_all_providers` directly in Rust (no `refresh-requested` event). The UI uses the `refresh_all_providers` command so all providers update together.
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

### Cursor

- Auth: `cursorAuth/accessToken` and related keys in Cursor `User/globalStorage` (`storage.json` or Windows `state.vscdb`).
- Usage: dashboard/usage HTTP endpoints on `cursor.com` (and related `api2.cursor.sh` calls where applicable); see `commands/cursor.rs` for the exact routes and headers.

### Other

- Anthropic status: `https://status.anthropic.com/api/v2/status.json`
- Local Stream Deck API: `http://127.0.0.1:52700/api/usage`, `/api/codex`, `/api/cursor`, and `POST /api/open`
- Browser import uses `rookie` to read browser cookie stores.
- Cursor usage uses Bearer auth against Cursor’s APIs (e.g. usage summary on `cursor.com`); see `commands/cursor.rs` for URLs and headers.

## Key Design Decisions

- No macOS keychain for Claude credentials; persistence uses `tauri-plugin-store`.
- Credentials are copied into an in-memory cache at startup to avoid repeated store I/O.
- Window focus auto-hides on focus loss unless “pinned”; 300ms focus guard prevents immediate dismissal; only `MouseButtonState::Up` is handled to avoid double-toggle.
- macOS Accessory mode (`set_activation_policy(Accessory)`) hides the dock icon.
- Claude, Codex, and Cursor share one poll schedule; each tick runs three fetches in parallel, then the tray refreshes once.
- The menu bar can be static or dynamic by provider, using app/bundle mappings from settings.
- The widget and main window intentionally consume the same shared usage events.
- Parsing is defensive: most Claude API fields are optional with `#[serde(default)]`.
- **Widget layout**: `WidgetOverlay.tsx` renders selectable **deck** or **ticker** layouts; card copy comes from `selectors.ts` (Claude session/weekly/extra/prepaid/status plus Codex and Cursor when data exists).
- **Click-through**: Only the header strip is a mouse hitbox; cards stay click-through (see `WidgetOverlay.tsx` + `hook.rs`).
- Widget show/hide comes from the tray menu.

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

## Widget Notes

- `src/widget/WidgetApp.tsx` mounts `WidgetOverlay` inside `WidgetProvider`.
- `src/widget/WidgetOverlay.tsx` owns click-through toggling (`setIgnoreCursorEvents`), header hitboxes, `ResizeObserver` + `setSize` for auto-height, drag via `startDragging`, and `widget-geometry-sync` for `hook.rs` geometry.
- `src/widget/selectors.ts` maps Claude/Codex/Cursor/widget state into `WidgetCardViewModel` lists; `WidgetCard.tsx` renders each card.
- `src/hooks/useWidgetStore.ts` persists `WidgetOverlayLayout` (position, theme, density, layout mode, per-card visibility) under `widget_layout` in `credentials.json`.
- `src/widget/widget.css` styles deck/ticker surfaces; keep card areas non-interactive so click-through behavior stays correct.

## Windows Widget Shadow Regression

On Windows, the widget can still look like a floating rounded window even when the CSS is fully transparent. That border is native window shadow, not frontend styling.

- The fix is in `src-tauri/tauri.conf.json` on the `widget` window:
  - `"transparent": true`
  - `"decorations": false`
  - `"shadow": false`
- If you change widget transparency behavior, test in the real Tauri window, not just browser preview. Playwright/browser preview cannot reproduce Windows native shadow.
- If the widget suddenly shows a soft rounded border again, first verify that `shadow: false` is still present and that the app was fully restarted. Frontend HMR is not enough for native window shadow changes.

## Tauri Plugins

- `notification`
- `autostart`
- `sql`
- `store`
- `opener`
