# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

UsageWatch is a cross-provider, tray-first app (Tauri 2.x + React + TypeScript) that monitors usage limits across supported AI providers.

- The product metadata still says `Claude Usage Tracker`.
- The app polls Claude usage from `claude.ai`.
- It also detects Codex auth, polls Codex usage, and can swap tray output based on the active app.
- Cursor supports auth detection, provider mapping, and usage polling alongside Claude and Codex.

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
- An Axum server serves latest Claude, Codex, and Cursor snapshots on localhost for Stream Deck-style integrations.

### Backend (`src-tauri/src/`)

- `lib.rs`: app startup, plugin registration, tray/menu setup, focus monitor startup, HTTP server startup, unified polling (`start_unified_polling`), `refresh_all_providers`, and tray/provider state management.
- `commands/credentials.rs`: store-backed Claude credential persistence and connection testing.
- `commands/usage.rs`: Claude usage, billing, raw-response, and Anthropic status fetches.
- `commands/browser.rs`: browser and Claude Desktop cookie scanning for `sessionKey`.
- `commands/codex.rs`: Codex auth discovery, OAuth token refresh, and Codex usage fetches.
- `commands/cursor.rs`: Cursor globalStorage auth discovery and usage HTTP fetches when a token exists.
- `polling.rs`: one background loop that polls Claude, Codex, and Cursor in parallel each tick (`poll_all_providers`), with an immediate first poll after a short boot delay.
- `http_server.rs`: local API on `127.0.0.1:52700` (`/api/usage`, `/api/codex`, `/api/cursor`, `/api/open`).
- `credentials_cache.rs`: in-memory session/org cache.
- `models.rs`: Claude, Codex, tray, alert, and provider models.
- `tray_state.rs`: provider resolution plus tray refresh orchestration.
- `tray_renderer.rs`: countdown/title formatting helpers.
- `focus_monitor.rs`: frontmost-app tracking on macOS.
- `styled_tray.rs` and `native_tray.m`: custom native tray rendering bridge.

### Frontend (`src/`)

- `App.tsx`: initial credential check and view routing.
- `context/AppContext.tsx`: global app reducer for Claude/Codex/Cursor data and settings.
- `hooks/useUsageData.ts`: event listeners, `refresh_all_providers` for manual refresh, and online/offline handling.
- `hooks/useHistoryRecorder.ts`: SQLite snapshot recording.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts`: derived metrics and alert notifications.
- `components/SetupWizard.tsx`: browser auto-detect plus manual credential setup.
- `components/Settings.tsx`: account, tray, provider, alert, polling, and debug settings.
- `components/Popover.tsx`: Claude, Codex, and Cursor usage tabs when configured, billing cards, pin/focus behavior, and history view.

### Widget frontend

- `widget/WidgetApp.tsx` is the widget entrypoint.
- `widget/WidgetOverlay.tsx` implements deck/ticker layouts, header-only drag hitbox, click-through for cards, and window auto-resize (`ResizeObserver` + `setSize`).
- `widget/selectors.ts` and `widget/WidgetCard.tsx` derive card models from Claude/Codex/Cursor snapshot state.
- `useWidgetData.ts` primes from latest-update commands, listens for `usage-update` / `codex-update` / `cursor-update`, and fetches supplemental billing/status.
- `useWidgetStore.ts` persists `widget_layout` (theme, density, layout mode, visibility, position) in `credentials.json`.

## Events and State Flow

- Rust emits `usage-update`, `codex-update`, `cursor-update`, `provider-changed`, `open-settings`, and `window-opened`.
- Tray **Refresh** invokes `poll_all_providers` in Rust; the UI uses `refresh_all_providers` so all providers refresh together (there is no `refresh-requested` event).
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

### Cursor

- Token and profile data live under Cursor `User/globalStorage` (`storage.json` or Windows `state.vscdb`).
- Usage is fetched over HTTPS from Cursor’s dashboard/APIs; see `commands/cursor.rs`.

### Other endpoints

- Anthropic status: `https://status.anthropic.com/api/v2/status.json`
- Local API: `http://127.0.0.1:52700/api/usage`, `/api/codex`, `/api/cursor`, and `POST /api/open`

## Important Behaviors

- No keychain usage for Claude credentials.
- Claude, Codex, and Cursor share one poll loop; each tick fetches all three in parallel, then updates UI/tray once.
- Dynamic provider switching depends on app mappings and the frontmost-app monitor (macOS/Windows where enabled).
- Cursor can be selected as a provider in tray settings and receives the same polling cadence as the other providers.
- The widget intentionally reuses main-window data flows instead of introducing a separate backend.

## macOS Tray Notes

Do not casually refactor the custom tray bridge.

- Keep `.show_menu_on_left_click(false)` in place.
- Keep `with_inner_tray_icon(...)` registration in `lib.rs`.
- Do not remove exported bridge functions from `native_tray.m`.
- Do not rely on default `NSStatusItem.menu` behavior if you need left-click popover plus right-click menu.
- If clicks break, first verify the native registration path and `TaoTrayTarget` z-order fix.

## Widget Notes

- `WidgetOverlay.tsx` + `WidgetCard.tsx`: glass-style deck or ticker; cards are display-only for click-through.
- `selectors.ts` defines which cards appear (Claude usage, prepaid, Codex/Cursor lines, API status, etc.).
- `widget.css` styles deck/ticker cells; keep non-header regions out of the mouse hitbox list.
- Widget show/hide is controlled via the tray menu.
- `useWidgetStore.ts` persists the full `WidgetOverlayLayout` under `widget_layout`.

## Windows Widget Shadow Regression

On Windows, the widget can appear as a floating rounded window even when CSS is transparent — that border is native window shadow, not frontend styling.

- The fix lives in `src-tauri/tauri.conf.json` on the `widget` window: `"transparent": true`, `"decorations": false`, `"shadow": false`.
- If the widget suddenly shows a soft rounded border, verify `shadow: false` is still present and the app was fully restarted (HMR is insufficient for native window shadow changes).

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
