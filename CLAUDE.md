# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

UsageWatch is a cross-provider, tray-first app (Tauri 2.x + React + TypeScript) that monitors usage limits across supported AI providers.

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
- `.mcp.json` configures the UsageWatch MCP server for Claude Code.
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
- `commands/browser.rs`: browser cookie scanning for Claude, Codex (ChatGPT session tokens), and Cursor credentials, plus Claude Desktop / ChatGPT Desktop app cookie extraction.
- `commands/codex.rs`: Codex auth discovery, OAuth token refresh, and Codex usage fetches.
- `commands/cursor.rs`: Cursor globalStorage auth discovery and usage HTTP fetches when a token exists.
- `commands/claude_oauth.rs`: reads Claude Code OAuth credentials from macOS Keychain or `~/.claude/.credentials.json`, with auto-refresh near expiry.
- `polling.rs`: one background loop that polls Claude, Codex, and Cursor in parallel each tick (`poll_all_providers`), with an immediate first poll after a short boot delay.
- `http_server.rs`: local API on `127.0.0.1:52700` (`/api/usage`, `/api/codex`, `/api/cursor`, `/api/open`).
- `credentials_cache.rs`: in-memory session/org cache.
- `models.rs`: Claude, Codex, tray, alert, and provider models.
- `tray_state.rs`: provider resolution plus tray refresh orchestration.
- `tray_renderer.rs`: countdown/title formatting helpers.
- `focus_monitor.rs`: frontmost-app and window-title tracking (macOS via accessibility observers, Windows via `GetForegroundWindow`/`GetWindowTextW`, Linux stub).
- `hook.rs`: global mouse position tracking for widget hover/hitbox detection; macOS native `NSEvent` monitor, Windows/Linux via `rdev`.
- `styled_tray.rs` and `native_tray.m`: custom native tray rendering bridge.

### Frontend (`src/`)

- `App.tsx`: initial credential check and view routing.
- `context/AppContext.tsx`: global app reducer for Claude/Codex/Cursor data and settings.
- `hooks/useUsageData.ts`: event listeners, `refresh_all_providers` for manual refresh, and online/offline handling.
- `hooks/useHistoryRecorder.ts`: SQLite snapshot recording.
- `hooks/useBurnRate.ts` and `hooks/useAlertEngine.ts`: derived metrics and alert notifications.
- `components/setup/ProviderMethodPicker.tsx` and `components/setup/MethodCard.tsx`: multi-provider auth setup flow (browser scan, desktop app detection, manual entry, Claude OAuth).
- `components/Settings.tsx`: account, tray, provider, alert, polling, and debug settings.
- `components/Popover.tsx`: Claude, Codex, and Cursor usage tabs when configured, billing cards, pin/focus behavior, and history view.
- `components/DebugPanel.tsx`, `HistoryChart.tsx`, `StatusIndicator.tsx`, `UsageBar.tsx`: diagnostics and visualization.
- `components/WidgetCardConfigurator.tsx`: drag-reorder card configurator for per-provider card visibility.
- `context/WidgetContext.tsx`: widget state context shared by widget components.
- `types/usage.ts`, `types/widget.ts`, `types/setup.ts`: TypeScript type definitions.
- `utils/format.ts`: formatting utilities (countdown timers, currency, usage colors).

### Widget frontend

- `widget/WidgetApp.tsx` is the widget entrypoint.
- `widget/WidgetOverlay.tsx` implements themed widget layouts (6 themes: rainmeter-stack, gauge-tower, side-rail, mono-ticker, signal-deck, matrix-rain), click-through for cards, header drag hitbox, and window auto-resize (`ResizeObserver` + `setSize`).
- `widget/selectors.ts` and `widget/WidgetCard.tsx` derive and render card models from Claude/Codex/Cursor snapshot state.
- `widget/themes.ts`: 6 theme definitions with per-density configurations for gap, padding, sizing, and surface styling.
- `widget/layout.ts`: layout normalization with legacy migration (v1/v2 to v3 format).
- `widget/MatrixRain.tsx`: canvas-based phosphor animation for the matrix-rain theme.
- `widget/WidgetPreview.tsx`: browser preview mode with synthetic data.
- `useWidgetData.ts` primes from latest-update commands, listens for `usage-update` / `codex-update` / `cursor-update`, and fetches supplemental billing/status.
- `useWidgetStore.ts` persists `widget_layout` (theme, density, layout mode, visibility, position) in `credentials.json`; `widget/layout.ts` handles normalization.

## Events and State Flow

- Rust emits `usage-update`, `codex-update`, `cursor-update`, `provider-changed`, `open-settings`, `window-opened`, and `device-mouse-move` (widget hitbox).
- Frontend emits `widget-geometry-sync` (to Rust for geometry cache) and `widget-layout-updated` (between windows).
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
- Local API: `http://127.0.0.1:52700/api/usage`, `/api/codex`, `/api/cursor`, `/api/billing`, and `POST /api/open`

## Important Behaviors

- Claude session keys use `tauri-plugin-store`; Claude OAuth (when available) reads from macOS Keychain or `~/.claude/.credentials.json` via `commands/claude_oauth.rs`.
- Claude, Codex, and Cursor share one poll loop; each tick fetches all three in parallel, then updates UI/tray once.
- Dynamic provider switching depends on app mappings and the frontmost-app monitor (macOS/Windows where enabled).
- Cursor can be selected as a provider in tray settings and receives the same polling cadence as the other providers.
- The widget intentionally reuses main-window data flows instead of introducing a separate backend.
- The local HTTP API server (port 52700) is opt-in via `http_server_enabled` in `credentials.json`. It starts at launch if enabled; changes require a restart.

## macOS Tray Notes

Do not casually refactor the custom tray bridge.

- Keep `.show_menu_on_left_click(false)` in place.
- Keep `with_inner_tray_icon(...)` registration in `lib.rs`.
- Do not remove exported bridge functions from `native_tray.m`.
- Do not rely on default `NSStatusItem.menu` behavior if you need left-click popover plus right-click menu.
- If clicks break, first verify the native registration path and `TaoTrayTarget` z-order fix.

## Widget Notes

- `WidgetOverlay.tsx` + `WidgetCard.tsx`: themed widget layouts (6 theme families); cards are display-only for click-through.
- `selectors.ts` defines which cards appear (Claude usage, prepaid, Codex/Cursor lines, API status, etc.).
- `widget.css` styles theme surfaces; keep non-header regions out of the mouse hitbox list.
- Widget show/hide is controlled via the tray menu.
- `useWidgetStore.ts` persists the full `WidgetOverlayLayout` under `widget_layout`.

## Windows Widget Shadow Regression

On Windows, a widget can look like it has a gray backing surface or a floating rounded window even when the root CSS is transparent. There are two different classes of problem:

1. Native window composition problems
This is the actual Tauri/WebView window failing to stay transparent.

2. Theme/rendering problems
This is the widget technically remaining transparent, but card-level shadows/glows make it visually read like a gray window behind the cards.

Both have to be handled correctly.

### Required native window invariants

The `widget` window in `src-tauri/tauri.conf.json` must keep all of these:

- `"transparent": true`
- `"decorations": false`
- `"shadow": false`

These are mandatory. If any of them change, Windows may render a native border/shadow again.

### Required runtime transparency hooks

Keep these runtime safeguards in place:

- `src-tauri/src/lib.rs`
  - `configure_widget_hwnd(...)`
  - `force_widget_transparent(...)`
- `src/widget/WidgetOverlay.tsx`
  - `invoke("force_widget_transparent")` after mount
- `src/widget/WidgetApp.tsx`
  - runtime root/background styles for `html`, `body`, and `#widget-root` must stay transparent in the real Tauri widget window

These are important because Windows/WebView2 transparency is not just a CSS concern; it depends on the native window and the webview backing surface staying transparent together.

### SOP for transparent-safe widget themes

When adding or modifying widget themes on Windows, treat `Mono Ticker` as the safe baseline.

`Mono Ticker` stays visually transparent because it does **not** use the heavy generic slab-card rendering path. It uses the lightweight ticker-cell path in `WidgetOverlay.tsx`, with simple card fills and borders only.

`Rainmeter Stack` reproduced the problem because it used the slab-stack card path in `WidgetCard.tsx` together with multiple glow/shadow effects. The fix was to remove the slab-only effects that made the cards visually behave like a gray-backed window:

- outer card shadow
- decorative accent orb
- slab icon glow shadow
- progress-fill glow shadow

In practice, for Windows-safe widget themes:

- Prefer flat fills, borders, and simple gradients
- Prefer no outer card shadow when possible
- Avoid large diffuse shadows around the whole card
- Avoid large radial glow layers behind or around cards
- Avoid glow-heavy accent effects that bleed beyond the card bounds
- Avoid using decorative ambient effects as if the widget had an opaque canvas behind it

This is especially important for themes that use the generic `.widget-card` slab path in `src/widget/widget.css`.

### Safe pattern

These are generally safe:

- transparent widget root
- simple linear-gradient card backgrounds
- thin borders
- compact meters
- small, contained highlights inside the card bounds

### Unsafe pattern

These are high risk on Windows and should be treated with suspicion:

- large outer `box-shadow` on the whole card
- ambient radial glows around the card
- icon glows that extend outside the card silhouette
- progress glows that create a soft halo outside the card
- any theme effect that makes the transparent window visually resemble a soft rectangular backing layer

### Debugging checklist

If a widget suddenly looks gray again on Windows:

1. Check the native window config first
   Confirm `transparent: true`, `decorations: false`, and `shadow: false` are still present on the `widget` window.
2. Check the runtime transparency path
   Confirm `force_widget_transparent(...)` is still invoked after mount and the widget root/background is still transparent.
3. Compare against `Mono Ticker`
   If `Mono Ticker` looks correct but another theme does not, the problem is probably theme rendering, not the native window.
4. Remove visual effects in this order
   Remove outer card shadow first, then ambient/radial glows, then icon glow, then progress glow.
5. Test in the real Tauri widget window
   Browser preview is not sufficient for Windows transparency validation.
6. Fully restart the app
   Frontend HMR is not enough for native window shadow/transparency changes.

### Rule of thumb

If `Mono Ticker` is transparent and another theme is not, do not start by changing Tauri config again. First diff the theme/card CSS and remove slab-style ambient shadows and glow layers until the theme behaves like a transparent overlay instead of a floating panel.

## Skills / Reusable Claude Assets

What exists:

- Repo-local Claude config in `.claude/`

What does not currently exist in this repo:

- repo-local Claude Code skills
- repo-local slash commands
- repo-local Claude agents

## Tauri Plugins

- `notification`
- `autostart`
- `sql`
- `store`
- `opener`
- `dialog`

## MCP Server

An MCP server at `mcp-server/` is configured via `.mcp.json` and provides real-time usage data to Claude Code and similar MCP clients. It connects to the local HTTP API on port 52700.

Tools:
- `get_usage_overview`: combined summary across all providers
- `get_claude_usage`: detailed Claude session/weekly/extra data
- `get_claude_billing`: prepaid credits, promotion credit, bundle reset date
- `get_codex_usage`: detailed Codex session/weekly/credits data
- `get_cursor_usage`: detailed Cursor spend/plan/billing data
- `open_app`: show and focus the UsageWatch window

Built with `@modelcontextprotocol/sdk`; run `npm run build` inside `mcp-server/` to compile.
