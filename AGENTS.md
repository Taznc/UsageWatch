# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

UsageWatch — a cross-provider tray app (Tauri 2.x + React + TypeScript) that monitors usage limits across supported AI providers.

## Build & Run

```bash
npm run tauri dev          # Dev mode (hot reload frontend + Rust rebuild on change)
npm run build              # Frontend only: tsc + vite build
cargo build --manifest-path src-tauri/Cargo.toml  # Rust only
```

Requires Rust via rustup (not Homebrew — `~/.cargo/env` must be sourced). Minimum Rust 1.94+.

## Architecture

**Tray-first app**: No dock icon, no traditional window. The 380x800 frameless popover appears under the tray icon on left-click. Right-click shows context menu (Refresh/Settings/Quit).

**Backend (Rust, `src-tauri/src/`):**
- `lib.rs` — App setup: plugin registration, tray icon/menu, window positioning, polling init
- `commands/credentials.rs` — Tauri commands for credential CRUD. Uses `tauri-plugin-store` (JSON file) with an in-memory `CredentialsCache` to avoid repeated I/O
- `commands/usage.rs` — Fetches usage, billing (prepaid/credits, overage_credit_grant, prepaid/bundles), and Anthropic status page
- `polling.rs` — Background tokio task: polls usage API every 60s (min 30s), updates tray title with session %, emits `usage-update` event
- `models.rs` — Serde structs matching claude.ai API response (fields use `#[serde(default)]` for resilience)
- `credentials_cache.rs` — Mutex-wrapped in-memory cache loaded once from store at startup
- `styled_tray.rs` — macOS FFI boundary for graphical tray rendering and native `NSStatusItem` registration
- `native_tray.m` — AppKit bridge for styled tray drawing, click/menu preservation, and `TaoTrayTarget` z-order repair

**Frontend (React, `src/`):**
- `App.tsx` — Credential check on mount, view routing (setup/settings/popover), window-open animation
- `context/AppContext.tsx` — useReducer-based global state (view, usageData, settings, offline status)
- `hooks/useUsageData.ts` — Listens to `usage-update`, `refresh-requested`, `open-settings` Tauri events
- `hooks/useHistoryRecorder.ts` — Records each poll to SQLite via `@tauri-apps/plugin-sql` (25s debounce)
- `components/Popover.tsx` — Main UI: usage bars, billing cards, drag handling, pin/focus logic, history toggle
- `types/usage.ts` — TypeScript interfaces mirroring Rust models
- `widget/WidgetWindow.tsx` — Transparent widget window shell; auto-sizes to content and starts native dragging from the rendered strip
- `widget/ReferenceGlassWidget.tsx` — Fixed screenshot-inspired widget renderer; this is the live widget path
- `context/WidgetContext.tsx` / `hooks/useWidgetData.ts` / `hooks/useWidgetStore.ts` — Minimal widget state: latest polled data + persisted position only

**Communication pattern:** Rust emits events (`usage-update`, `window-opened`, `refresh-requested`), frontend listens via `@tauri-apps/api/event`. Frontend calls Rust via `invoke()` for commands.

## API Endpoints Used

All authenticated with `cookie: sessionKey={key}` header against `claude.ai`:
- `/api/organizations` — List orgs (connection test)
- `/api/organizations/{org_id}/usage` — Usage data (5h session, 7d weekly, per-model, extra usage)
- `/api/organizations/{org_id}/prepaid/credits` — Account balance
- `/api/organizations/{org_id}/overage_credit_grant` — Promotion credits
- `/api/organizations/{org_id}/prepaid/bundles` — Bundle pricing, monthly reset date
- `status.anthropic.com/api/v2/status.json` — System status (no auth)

API field names: `utilization` (not `utilization_pct`), `resets_at` (not `reset_at`), money values in cents.

## Key Design Decisions

- **No keychain**: Switched from `keyring` crate to `tauri-plugin-store` because macOS Keychain prompted for password repeatedly
- **In-memory credential cache**: Store file read once at startup, writes go to both cache and file
- **Window focus behavior**: Auto-hides on focus loss unless "pinned". 300ms focus guard after open to prevent immediate dismissal. Only handles `MouseButtonState::Up` to avoid double-toggle
- **macOS Accessory mode**: `set_activation_policy(Accessory)` hides dock icon
- **Resilient parsing**: All API response fields are `Option` with `#[serde(default)]` — missing/new fields won't break the app
- **Widget is now fixed-layout**: The live widget is no longer a themeable tile editor. It is one fixed vertical “reference glass stack” mapped from existing UsageWatch data.
- **No in-widget controls in normal mode**: Widget show/hide comes from the tray menu. Do not reintroduce visible edit/theme/header chrome into the live widget unless explicitly requested.
- **Transparent gaps are intentional**: The space between widget slabs must stay fully transparent so the desktop/background shows through. Avoid shared backing panels, stack-level shadows, or enclosing cards.

## macOS Tray Click Behavior

The tray uses a custom graphical renderer on macOS instead of plain `set_title()`. That renderer is safe only because the app explicitly re-attaches itself to Tauri's real tray internals.

- `src-tauri/src/lib.rs` builds the tray with `.show_menu_on_left_click(false)`. Left-click is handled by `on_tray_icon_event` and opens/closes the popover. Right-click is expected to open the tray menu.
- Immediately after building the tray, `lib.rs` calls `tray.with_inner_tray_icon(...)` and passes the real `NSStatusItem` pointer into `styled_tray::register_native_status_item(...)`.
- `src-tauri/src/styled_tray.rs` is only an FFI shim. The real AppKit logic lives in `src-tauri/src/native_tray.m`.
- `src-tauri/src/native_tray.m` draws the styled text into an `NSImage`, sets it on the tray button, detaches the `NSMenu` from `NSStatusItem`, and replays right-click / `ctrl`-click manually with `popUpMenuPositioningItem`.
- After every redraw, `ensureSubviewCoverage(...)` resizes and re-adds Tauri's `TaoTrayTarget` as the top subview. This is critical: if the graphical tray content ends up above `TaoTrayTarget`, left/right click events stop reaching Tauri.

## Tray Regression Notes

This app previously regressed when the tray switched to a more graphical rendering mode.

- Root cause: the native tray patch tried to discover the tray button by scanning `NSStatusBarWindow` instances. That is unreliable once the tray is custom-drawn and can bind the fix to the wrong status item or leave `TaoTrayTarget` underneath AppKit's content view.
- Resolution: register the exact `NSStatusItem` created by Tauri via `with_inner_tray_icon`, then repair `TaoTrayTarget` z-order after each styled redraw.
- Do not remove the exported native functions in `native_tray.m`. `register_tray_status_item(...)` and `set_styled_tray_title(...)` are used by Rust FFI and intentionally marked with explicit symbol visibility.
- Do not switch back to `NSStatusItem.menu`-driven default behavior if you want left-click popover + right-click menu with styled graphics. The current behavior depends on detaching the menu and replaying secondary click manually.
- If tray clicks break again, first verify that launch logs still show the native click fix initialization and that left clicks emit `[tray] event:` lines from `lib.rs`.

## Widget Notes

The widget was rebuilt to visually match a desktop-widget reference instead of the old theme/tile system.

- `src/widget/ReferenceGlassWidget.tsx` is the only runtime renderer for the widget strip. It builds a fixed ordered set of rows from existing app data:
  - session usage
  - weekly usage
  - extra usage
  - prepaid balance
  - Codex session
  - Codex credits
  - Anthropic/API status
- `src/widget/widget.css` intentionally styles each row as an independent frosted slab with:
  - overlapping circular badge on the left
  - higher-opacity readable glass surface
  - no shared container shadow
  - no slab shadow or edge glow outside the material
  - transparent gaps between rows
- `src/widget/WidgetWindow.tsx` auto-sizes the widget window to the rendered strip and starts dragging from the widget body itself, so no visible header bar is required.
- `src/hooks/useWidgetStore.ts` now persists only widget position. Older saved layout/theme/tile data may still exist in the store, but the live widget no longer uses it.

## Windows Widget Shadow Regression

On Windows, the widget can still look like a floating rounded window even when the CSS is fully transparent. That border is native window shadow, not frontend styling.

- The fix is in `src-tauri/tauri.conf.json` on the `widget` window:
  - `"transparent": true`
  - `"decorations": false`
  - `"shadow": false`
- If you change widget transparency behavior, test in the real Tauri window, not just browser preview. Playwright/browser preview cannot reproduce Windows native shadow.
- If the widget suddenly shows a soft rounded border again, first verify that `shadow: false` is still present and that the app was fully restarted. Frontend HMR is not enough for native window shadow changes.

## Tauri Plugins

`notification`, `autostart`, `sql` (SQLite), `store` (credential persistence), `opener`
