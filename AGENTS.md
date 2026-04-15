# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

UsageWatch is a cross-provider, tray-first app (Tauri 2.x + React + TypeScript) that monitors usage limits across supported AI providers.

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
- `.mcp.json` in the repo root configures the UsageWatch MCP server for Claude Code sessions.
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
- `commands/browser.rs` scans installed browsers (Chrome, Firefox, Zen, Arc, Brave, Edge, Vivaldi, Opera, Chromium, Safari on macOS) for Claude (`sessionKey`), Codex (ChatGPT session tokens including chunked variants), and Cursor browser sessions. Also scans Claude Desktop and ChatGPT Desktop Electron cookie stores. A unified `scan_browsers(provider)` command dispatches to the correct scanner.
- `commands/codex.rs` reads `~/.codex/auth.json` or `$CODEX_HOME/auth.json`, refreshes OpenAI OAuth tokens when stale, and polls Codex usage from `chatgpt.com`.
- `commands/cursor.rs` reads Cursor `globalStorage` (`storage.json` or Windows `state.vscdb`), resolves auth, and fetches usage from Cursor’s HTTP APIs when a token is available.
- `commands/claude_oauth.rs` reads Claude Code OAuth credentials. On macOS, reads from the Keychain service `"Claude Code-credentials"` via `security find-generic-password`; on other platforms falls back to `~/.claude/.credentials.json`. Auto-refreshes access tokens within 5 minutes of expiry.
- `polling.rs` runs a **single** background loop (`start_unified_polling`): on each tick it fetches Claude, Codex, and Cursor **in parallel** (`tokio::join!` via `poll_all_providers`), updates shared caches, emits events, and refreshes the tray. After a short boot delay (~400ms) it runs an immediate first poll, then repeats on the user-configured interval (`poll_interval_secs`, minimum 30s).
- `http_server.rs` runs an Axum server on `127.0.0.1:52700` with `GET /api/usage`, `GET /api/codex`, `GET /api/cursor`, and `POST /api/open`.
- `credentials_cache.rs` avoids repeated store reads by keeping session/org values in memory.
- `models.rs` holds resilient Claude response types plus frontend-ready Codex/Cursor/tray/provider models.
- `tray_state.rs` decides which provider to render and pushes styled/native tray updates.
- `tray_renderer.rs` contains countdown/title formatting helpers.
- `focus_monitor.rs` watches the frontmost application and window title. On macOS, uses accessibility observers (`NSWorkspace` app activation + `AXObserver` title changes). On Windows, polls `GetForegroundWindow` / `GetWindowTextW`. Linux has a no-op stub.
- `hook.rs` provides global mouse position tracking for widget hover/hitbox detection. On macOS uses a native `NSEvent` global monitor (registered via `styled_tray.rs`); on non-macOS uses `rdev::listen`. Emits `device-mouse-move` with widget-relative coordinates and listens for `widget-geometry-sync` to keep its cached window geometry accurate.
- `styled_tray.rs` and `native_tray.m` implement the macOS custom tray image/title bridge.

### Frontend (`src/`)

- `App.tsx` mounts the app provider, checks whether credentials exist, and routes between setup, settings, and popover views.
- `context/AppContext.tsx` stores Claude, Codex, and Cursor data, settings, view state, and offline/loading flags.
- `hooks/useUsageData.ts` listens for Rust events, calls `refresh_all_providers` for manual refresh (popover / UI), and tracks online/offline state.
- `hooks/useHistoryRecorder.ts` writes Claude usage snapshots into SQLite.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts` derive burn-rate and native alert behavior from stored history/current usage.
- `components/setup/ProviderMethodPicker.tsx` and `components/setup/MethodCard.tsx`: multi-provider auth setup flow supporting browser scan, desktop-app auth, manual entry, and Claude OAuth file methods. Method definitions live in `types/setup.ts`.
- `components/Settings.tsx` manages Claude credentials, tray format, provider mappings, alerts, autostart/polling, debug info, and Codex/Cursor connection checks.
- `components/Popover.tsx` renders Claude, Codex, and Cursor tabs (when configured), billing, history, pin behavior, and refresh/settings actions.
- `components/DebugPanel.tsx`, `HistoryChart.tsx`, `StatusIndicator.tsx`, and `UsageBar.tsx` support diagnostics and visualization.
- `components/WidgetCardConfigurator.tsx`: drag-and-drop card configurator for widget card ordering and per-provider card visibility toggling (uses `@dnd-kit`).
- `context/WidgetContext.tsx`: widget state context providing usage data, layout, and provider state to all widget components.
- `types/usage.ts`: core TypeScript types for providers, usage data, billing, Codex/Cursor data.
- `types/widget.ts`: widget type definitions (theme IDs, density, layout family, card IDs, `WidgetOverlayLayout` with position, theme, density, scale, card order, card visibility, and theme overrides).
- `utils/format.ts`: shared formatting utilities (countdown timers, currency, usage colors).

### Widget frontend (`src/widget/` + `src/context/WidgetContext.tsx` + `src/hooks/useWidget*.ts`)

- `widget/WidgetApp.tsx` is the widget entrypoint (mounts `WidgetOverlay`).
- `widget/WidgetOverlay.tsx` implements themed widget layouts (6 themes: rainmeter-stack, gauge-tower, side-rail, mono-ticker, signal-deck, matrix-rain), click-through, header drag, and window auto-resize.
- `widget/selectors.ts` and `widget/WidgetCard.tsx` build and render usage cards from shared app state.
- `widget/themes.ts`: 6 theme definitions with per-density configurations for stack gap, card dimensions, padding, surface gradient, border, blur, and layout family assignment.
- `widget/layout.ts`: layout normalization and migration. Migrates legacy v1/v2 layouts to v3 format; normalizes theme ID (maps deprecated names), density, scale, card order, and per-provider card visibility.
- `widget/MatrixRain.tsx`: canvas-based phosphor rain animation for the `matrix-rain` theme.
- `widget/WidgetPreview.tsx`: browser preview mode rendering with synthetic mock data for all three providers.
- `useWidgetData.ts` listens for Claude/Codex/Cursor events and primes from `get_latest_*_update` plus supplemental billing/status fetches on mount.
- `useWidgetStore.ts` persists `widget_layout` in `credentials.json`; `widget/layout.ts` handles normalization.

## Communication Pattern

- Rust emits `usage-update` (Claude), `codex-update`, `cursor-update`, `provider-changed`, `open-settings`, `window-opened`, and `device-mouse-move` (widget-relative mouse position for hitbox detection).
- Frontend emits `widget-geometry-sync` (triggers geometry cache update in `hook.rs` after layout-driven resizes) and `widget-layout-updated` (Settings notifies widget to reload layout).
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

- Claude session keys (legacy `sessionKey` auth) use `tauri-plugin-store`. Claude OAuth tokens (when available) are read from the macOS Keychain service `"Claude Code-credentials"` or from `~/.claude/.credentials.json`, with auto-refresh handled by `commands/claude_oauth.rs`.
- Credentials are copied into an in-memory cache at startup to avoid repeated store I/O.
- Window focus auto-hides on focus loss unless “pinned”; 300ms focus guard prevents immediate dismissal; only `MouseButtonState::Up` is handled to avoid double-toggle.
- macOS Accessory mode (`set_activation_policy(Accessory)`) hides the dock icon.
- Claude, Codex, and Cursor share one poll schedule; each tick runs three fetches in parallel, then the tray refreshes once.
- The menu bar can be static or dynamic by provider, using app/bundle mappings from settings.
- The widget and main window intentionally consume the same shared usage events.
- Parsing is defensive: most Claude API fields are optional with `#[serde(default)]`.
- **Widget themes**: `WidgetOverlay.tsx` renders 6 selectable theme families (rainmeter-stack, gauge-tower, side-rail, mono-ticker, signal-deck, matrix-rain) with per-density sizing; card data comes from `selectors.ts`. Theme definitions live in `widget/themes.ts`; layout normalization and legacy migration in `widget/layout.ts`.
- **Click-through**: Only the header strip is a mouse hitbox; cards stay click-through (see `WidgetOverlay.tsx` + `hook.rs`).
- **Card configurator**: `WidgetCardConfigurator.tsx` provides drag-reorder with `@dnd-kit` and per-provider card visibility toggles. Card types: session, weekly, extra, balance, credits, status.
- Widget show/hide comes from the tray menu.
- **Peak hours**: Polling fetches peak/off-peak status from PromoClock's public API (`PeakHoursStatus` in `models.rs`); the MCP server and widget display peak/off-peak/weekend badges.
- **Multi-segment tray**: `TrayMode::Multi` supports arbitrary tray segments (`TraySegmentDef`) with per-segment provider data or custom text. macOS renders each segment with individual RGBA color, font size, and bold via `styled_tray.rs` / `native_tray.m`.
- **Window title matching**: When `title_matching_enabled` is set in `TrayConfig`, Dynamic mode passes the frontmost window title alongside bundle/app name to `match_provider()` for more precise provider resolution.
- **Accessibility permissions**: macOS focus monitoring and window title tracking require Accessibility permissions. `focus_monitor.rs` exposes `is_accessibility_trusted()` and `request_accessibility()` which map to macOS `AXIsProcessTrustedWithOptions`.

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
- `src/widget/widget.css` styles theme surfaces; keep card areas non-interactive so click-through behavior stays correct.

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
- `dialog`

## MCP Server

A local MCP (Model Context Protocol) server at `mcp-server/` exposes UsageWatch data to Claude Code and other MCP-compatible clients.

### Configuration

`.mcp.json` in the repo root registers the server:

```json
{
  "mcpServers": {
    "usagewatch": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"]
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `get_usage_overview` | Combined summary across Claude, Codex, and Cursor |
| `get_claude_usage` | Session/weekly rate limits, extra usage spend, peak hours, reset timers |
| `get_codex_usage` | Session/weekly limits, code review limits, credits, plan type |
| `get_cursor_usage` | Plan spend vs limit, on-demand usage, bonus credits, billing cycle |

### Implementation

- Built with `@modelcontextprotocol/sdk` (stdio transport).
- Connects to the local HTTP API at `http://127.0.0.1:52700` (same endpoints the Stream Deck integration uses).
- Handles three app states: `ok` (data returned), `unavailable` (provider not configured), `app_not_running` (UsageWatch not running).
- Build: `cd mcp-server && npm run build`.
