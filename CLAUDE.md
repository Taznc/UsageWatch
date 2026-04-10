# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Usage Tracker — a macOS menu bar app (Tauri 2.x + React + TypeScript) that monitors Claude AI usage limits by polling internal claude.ai API endpoints using a session cookie.

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

**Frontend (React, `src/`):**
- `App.tsx` — Credential check on mount, view routing (setup/settings/popover), window-open animation
- `context/AppContext.tsx` — useReducer-based global state (view, usageData, settings, offline status)
- `hooks/useUsageData.ts` — Listens to `usage-update`, `refresh-requested`, `open-settings` Tauri events
- `hooks/useHistoryRecorder.ts` — Records each poll to SQLite via `@tauri-apps/plugin-sql` (25s debounce)
- `components/Popover.tsx` — Main UI: usage bars, billing cards, drag handling, pin/focus logic, history toggle
- `types/usage.ts` — TypeScript interfaces mirroring Rust models

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

## Tauri Plugins

`notification`, `autostart`, `sql` (SQLite), `store` (credential persistence), `opener`
