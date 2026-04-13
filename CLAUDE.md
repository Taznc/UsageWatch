# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

UsageWatch is a tray-first macOS Tauri 2.x app with a React + TypeScript frontend and Rust backend.

- The product metadata still says `Claude Usage Tracker`.
- The app polls Claude usage from `claude.ai`.
- It also detects Codex auth, polls Codex usage, and can swap tray output based on the active app.
- Cursor integration is limited to auth detection and provider mapping right now.

## Build & Run

```bash
npm run tauri dev
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
```

Notes:

- Vite dev runs on `1420`; Tauri HMR uses `1421`.
- This is a multi-page Vite app: `index.html` for the main UI and `widget/index.html` for the widget.
- If Rust is missing in a shell session, source `~/.cargo/env`.

## Claude Code Repo Config

Repo-local Claude configuration exists, but there are no repo-local Claude skills or slash commands to load.

- `.claude/launch.json` contains `tauri-dev` and `vite-frontend` launch targets.
- `.claude/settings.local.json` grants local Claude tooling bash and web-search permissions.
- No `.claude/commands`, `.claude/agents`, or repo skill files are present.

## Architecture

### Runtime model

- The app is tray-first and hides its dock icon on macOS.
- The main `main` window is a hidden frameless popover shown under the tray icon.
- A separate hidden `widget` window is also bundled.
- The tray can render styled provider-specific data and switch provider based on the focused app.
- An Axum server serves the latest Claude usage on localhost for Stream Deck-style integrations.

### Backend (`src-tauri/src/`)

- `lib.rs`: app startup, plugin registration, tray/menu setup, focus monitor startup, HTTP server startup, polling startup, and tray/provider state management.
- `commands/credentials.rs`: store-backed Claude credential persistence and connection testing.
- `commands/usage.rs`: Claude usage, billing, raw-response, and Anthropic status fetches.
- `commands/browser.rs`: browser and Claude Desktop cookie scanning for `sessionKey`.
- `commands/codex.rs`: Codex auth discovery, OAuth token refresh, and Codex usage fetches.
- `commands/cursor.rs`: Cursor auth file discovery and cached email lookup.
- `polling.rs`: separate Claude and Codex background polling loops.
- `http_server.rs`: local API on `127.0.0.1:52700`.
- `credentials_cache.rs`: in-memory session/org cache.
- `models.rs`: Claude, Codex, tray, alert, and provider models.
- `tray_state.rs`: provider resolution plus tray refresh orchestration.
- `tray_renderer.rs`: countdown/title formatting helpers.
- `focus_monitor.rs`: frontmost-app tracking on macOS.
- `styled_tray.rs` and `native_tray.m`: custom native tray rendering bridge.

### Frontend (`src/`)

- `App.tsx`: initial credential check and view routing.
- `context/AppContext.tsx`: global app reducer for Claude/Codex data and settings.
- `hooks/useUsageData.ts`: event listeners, manual refresh, and online/offline handling.
- `hooks/useHistoryRecorder.ts`: SQLite snapshot recording.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts`: derived metrics and alert notifications.
- `components/SetupWizard.tsx`: browser auto-detect plus manual credential setup.
- `components/Settings.tsx`: account, tray, provider, alert, polling, and debug settings.
- `components/Popover.tsx`: Claude and Codex usage tabs, billing cards, pin/focus behavior, and history view.

### Widget frontend

- `widget/WidgetApp.tsx` is the widget entrypoint.
- `WidgetWindow.tsx` restores position and resizes to content.
- `useWidgetData.ts` fetches immediate data and listens to shared update events.
- `useWidgetStore.ts` persists widget layout under `widget_layout` in the Tauri store.
- `widget/tiles/*` contains the actual tile components.

## Events and State Flow

- Rust emits `usage-update`, `codex-update`, `refresh-requested`, `open-settings`, and `window-opened`.
- React windows subscribe using `@tauri-apps/api/event`.
- Frontend code calls Rust via `invoke()`.
- The widget and main app both consume the same backend update stream.

## Persistence

- `tauri-plugin-store` file: `credentials.json`
- Store keys include Claude credentials, tray format, tray config, alert config, and widget layout.
- Claude history snapshots are persisted in `sqlite:usage_history.db`.

## Network/API Surface

### Claude endpoints

Authenticated with `cookie: sessionKey={key}`:

- `/api/organizations`
- `/api/organizations/{org_id}/usage`
- `/api/organizations/{org_id}/prepaid/credits`
- `/api/organizations/{org_id}/overage_credit_grant`
- `/api/organizations/{org_id}/prepaid/bundles`

Field expectations:

- `utilization`
- `resets_at`
- monetary values are minor units / cents

### Codex endpoints

- `https://auth.openai.com/oauth/token`
- `https://chatgpt.com/backend-api/wham/usage`

Auth is read from `~/.codex/auth.json` or `$CODEX_HOME/auth.json`.

### Other endpoints

- Anthropic status: `https://status.anthropic.com/api/v2/status.json`
- Local API: `http://127.0.0.1:52700/api/usage` and `POST /api/open`

## Important Behaviors

- No keychain usage for Claude credentials.
- Claude and Codex poll on separate loops and independently update UI/tray state.
- Dynamic provider switching depends on app mappings and the macOS frontmost-app monitor.
- Cursor can be selected as a provider in tray settings, but no Cursor polling exists yet.
- The widget intentionally reuses main-window data flows instead of introducing a separate backend.

## macOS Tray Notes

Do not casually refactor the custom tray bridge.

- Keep `.show_menu_on_left_click(false)` in place.
- Keep `with_inner_tray_icon(...)` registration in `lib.rs`.
- Do not remove exported bridge functions from `native_tray.m`.
- Do not rely on default `NSStatusItem.menu` behavior if you need left-click popover plus right-click menu.
- If clicks break, first verify the native registration path and `TaoTrayTarget` z-order fix.

## Skills / Reusable Claude Assets

What exists:

- Repo-local Claude config in `.claude/`

What does not currently exist in this repo:

- repo-local Claude Code skills
- repo-local slash commands
- repo-local Claude agents

I also checked the user-level `~/.claude` directory and found plans/cache/history content, but not a reusable skill library for this repo.

## Tauri Plugins

- `notification`
- `autostart`
- `sql`
- `store`
- `opener`
