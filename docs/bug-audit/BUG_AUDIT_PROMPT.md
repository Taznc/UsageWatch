# UsageWatch — Extensive Bug & Security Audit (single-session prompt)

> Paste everything below the line into a fresh Claude Code session **at the UsageWatch repo root**.
> It is **read-only**: it produces a report at `docs/bug-audit/BUG_AUDIT.md` and changes no product code.
> For the deeper multi-agent version, run the workflow instead (see bottom).
> Recommended: most capable model, high/extra reasoning effort, fast mode off.

---

You are conducting an **extensive, read-only bug and security audit** of the **UsageWatch** codebase
(a Tauri 2 desktop app — Rust backend + React/TypeScript webview — that tracks AI usage limits across
**Claude**, **Codex/OpenAI**, and **Cursor** in one place. It lives in the system tray, shows an
always-on-top transparent widget, exposes data over a local HTTP API on `127.0.0.1:52700` for Stream
Deck, ships an MCP server, and reads/refreshes credentials from many sources).

## Threat model — read this first (it differs from a server app)
UsageWatch is a **single-user, local desktop app**. There is **no login, no multi-tenant server, no
forced-logout**. Do **not** look for "cross-household / cross-tenant leak" — there are no tenants. The
crown jewels here are different, and the highest severities map to them:

1. **Harvested provider credentials.** The app reads Claude/Codex/Cursor session keys, cookies, OAuth and
   refresh tokens from **10+ browsers, the macOS Keychain, and other apps' files** (Claude Desktop,
   ChatGPT Desktop, Cursor's `globalStorage`, `~/.codex/auth.json`, `~/.claude/.credentials.json`). Any
   path that **leaks** these (logs, the local HTTP API, the IPC surface, the SQLite history, plaintext
   stores) or **exfiltrates** them is top severity.
2. **Integrity of files it writes back into OTHER tools.** On OAuth refresh it **rewrites Claude Code's
   own** `~/.claude/.credentials.json` / Keychain entry and **Codex's** `~/.codex/auth.json`, and it
   **edits users' MCP host configs** (Claude Desktop / Cursor / Codex). A non-atomic or wrong write there
   **corrupts a different program's auth or config** — cross-app data loss the user didn't ask for.
3. **Local code execution.** The Rust side spawns OS processes (`osascript`, `open`, `taskkill`, a
   lowercased binary name, `security`). Any one that interpolates an attacker- or config-controlled string
   into a shell/AppleScript command is an RCE / command-injection vector.
4. **Crash / data-dropping migration.** Crash-on-launch (panics in startup paths) and the widget-layout
   `v1/v2 → v3` migration silently dropping a user's saved layout/config.

## Hard constraints
- **READ-ONLY.** Do not edit, refactor, generate, or fix product code. No git mutations, installs, `cargo
  build`/`npm run build`, migrations, or deploys. Read-only shell is encouraged: `rg`/`grep`, `cat`,
  `sed -n`, `git log/blame/show/diff`, `ls`, `find`, lockfile inspection, `--dry-run`/`--help`. Building/
  running is **not** required.
- The **only** file you may write is `docs/bug-audit/BUG_AUDIT.md` (the final report). Create `docs/bug-audit/` if needed.
- If something is ambiguous, state your assumption in the report rather than blocking.

## Lenses, in priority order
1. **Security & data integrity** (weighted highest — see threat model)
2. **Correctness / logic bugs**
3. **UX / workflow consistency**
4. **Performance & scalability**

## Method
Work through the **territories** below. For broad sweeps, spawn parallel sub-agents (Explore /
general-purpose) — roughly one per territory — then verify their findings yourself before trusting them.
**Adversarially verify every candidate finding**: re-read the cited code and try to *refute* it; keep it
only if the failure scenario is genuinely reachable on a shipping path (not `#[cfg(test)]`, not a doc
example, not dev-only). Prefer **fewer, real, high-signal findings** over a long speculative list. Empty
territories are fine — do not invent issues to fill them.

## Evidence bar — every finding MUST have
- `file:line` reference(s) you actually read.
- A concrete, reachable failure scenario / repro (not "this looks fragile").
- Why it matters (user-visible impact or security/data consequence).
- A one-line fix sketch (describe it; **do not apply it**).
- A confidence: high / medium / low (be honest; label low-confidence items as such).

## Severity rubric (tuned for a local desktop app)
- **critical**: local RCE / command injection; arbitrary exfiltration of harvested provider credentials;
  corruption of **another tool's** credential or config file (breaks Claude Code / Codex / Cursor auth);
  a secret written somewhere world-readable or to logs that ship; crash-on-launch; a migration that drops
  user data/config.
- **high**: unauthenticated local exposure of secrets or spend data; silent **wrong-usage** display that
  makes the user blow past a real limit (e.g. shows 0% when actually maxed); partial-write corruption of
  the app's own store; cross-app config clobber that deletes the user's *other* MCP servers.
- **medium**: logic bug with a workaround; parsing gap that shows a wrong number; UX dead-end / silent
  failure; perf cliff under realistic use.
- **low**: edge-case bug, minor inconsistency, defensive-coding gap, low-impact info disclosure.

## Territories (with concrete entry points)

### Security & data integrity (highest priority)

1. **Local HTTP API server** — `src-tauri/src/http_server.rs`. It binds `127.0.0.1:52700` (line ~56) and
   serves `GET /api/usage|/api/codex|/api/cursor|/api/billing` + `POST /api/open` (lines ~47–54) with
   **no authentication token** on any route. The `CorsLayer` (lines ~39–45) only restricts *browser*
   origins — it does nothing to a `curl`/native local client, and a malicious web page may still reach it
   via DNS-rebinding since the bind is to a fixed loopback port. Determine: (a) do the response payloads
   (`UsageUpdate` / `BillingUpdate` / `CodexUpdate` / `CursorUpdate` in `polling.rs` + `models.rs`) ever
   include the **session key / bearer token itself**, or only derived usage numbers? (b) Can any local
   process read another user's **spend/billing** and pop the window (`POST /api/open` focus-steal)? (c) The
   handlers do `…lock().unwrap()` (lines 74, 83, 92, 101) — a poisoned mutex panics the server task. It is
   opt-in via `http_server_enabled` (documented) — so "the server exists" is **not** the bug; the
   unauthenticated surface + what it discloses is.

2. **Process spawning / command injection** — `src-tauri/src/process_monitor.rs`. Line ~438:
   `osascript -e 'tell application "{name}" to quit'` interpolates `name` **into an AppleScript string**.
   Line ~494 (Linux): `Command::new(&lower)` launches a binary whose name is the lowercased app name.
   **Trace every caller** of `kill_by_image` / `launch_app_named` / `restart_app_named` / `restart_app`
   back to its source — MCP host restart (`mcp_restart_host`, `commands/mcp.rs`), tray/app-mapping config,
   or a hardcoded enum? If `name` can contain a quote / newline / `do shell script`, that's AppleScript
   injection → **RCE**. Also confirm the `security` Keychain calls (`commands/codex.rs:65/85/88`,
   `commands/claude_oauth.rs:72/100/104`) and the Windows `reg`/`taskkill` calls pass **only fixed args**,
   never interpolated user/config strings.

3. **Credential storage at rest & leakage** — `src-tauri/src/commands/credentials.rs` writes
   `session_key`, `org_id`, `codex_manual_token`, `cursor_manual_token` to `credentials.json` via
   `tauri-plugin-store` in **plaintext** (`save_to_store`, line 7), while Claude OAuth uses the Keychain —
   is the plaintext-vs-Keychain split defensible, and is the file mode restrictive? Sweep for **secrets in
   logs**: `eprintln!`/`println!`/`log::`/`dbg!` that print a cookie, session key, bearer/OAuth token, or a
   raw API response containing one (check `usage.rs`, `codex.rs`, `cursor.rs`, `browser.rs`, and the
   `debug_*` commands: `debug_claude_api`, `debug_claude_api_raw`, `debug_claude_desktop_cookies`,
   `debug_cursor_api`). Does `usage_history.db` (SQLite) store anything sensitive? Do `get_session_key` /
   `get_codex_token` / `get_cursor_token` / `check_claude_oauth` hand raw secrets back to the webview where
   any injected script could read them (assess against the CSP in `tauri.conf.json`)?

4. **Credential harvesting from browsers / Keychain / other apps** — `src-tauri/src/commands/browser.rs`
   (`pull_session_from_browsers` L166, `pull_codex_session_from_browsers` L364, `scan_browsers`,
   `debug_claude_desktop_cookies` L88), `commands/codex.rs` (`check_codex_auth` ~L125, reads
   `~/.codex/auth.json` / `$CODEX_HOME` / Keychain), `commands/cursor.rs` (reads Cursor `globalStorage`
   `storage.json` / Windows `state.vscdb`), `commands/claude_oauth.rs`. Uses the `rookie` crate to decrypt
   cookie DBs and a temp-file copy for locked DBs. Check: are temp copies of cookie databases **cleaned
   up** (or do plaintext-decryptable cookie DBs linger in a temp dir)? Are decryption / parse failures
   handled without panicking? Is the scan scope wider than the documented opt-in discovery implies?

5. **Cross-app credential WRITE-BACK** — `src-tauri/src/commands/claude_oauth.rs` refreshes the Claude
   Code OAuth token (`get_claude_oauth_token` ~L190, refresh POST to `api.anthropic.com/auth/token/refresh`)
   and **writes the result back to Claude Code's own** Keychain entry / `~/.claude/.credentials.json`;
   `commands/codex.rs` similarly rewrites `~/.codex/auth.json` + the `"Codex Auth"` Keychain item. These
   are **other programs' credential files**. Verify: is each write **atomic** (temp + rename, not truncate-
   then-write), so a crash/partial write can't corrupt the file and break Claude Code / Codex auth? Is the
   5-minute "near expiry" refresh logic correct (no premature refresh that invalidates a still-valid token,
   no missed refresh)? Can the **poll loop's** refresh race a **manual** refresh and double-rotate a
   single-use refresh token, locking the user out?

6. **MCP host config management** — `src-tauri/src/commands/mcp.rs` (~1450 lines; commands at L1110–1432:
   `mcp_add_server`, `mcp_remove_server`, `mcp_copy_server`, `mcp_set_enabled`, `mcp_set_enabled_bulk`,
   `mcp_register_project`, `mcp_unregister_project`, `mcp_restart_host`, …). It **reads and rewrites users'
   real MCP config files** for Claude Desktop / Cursor / Codex, with atomic temp+rename and a first-edit
   backup to `<app_data>/mcp-backups/`. Verify: round-tripping the config **preserves unknown keys / the
   user's other MCP servers** (no clobber → data loss); the backup is written **before** the first mutation
   and is restorable; config-path discovery can't be redirected via symlink/`../` path traversal; bulk
   enable/disable can't drop entries on a partial failure.

### Correctness / logic

7. **Unified polling & defensive parsing** — `src-tauri/src/polling.rs` (`poll_all_providers`, single loop,
   `tokio::join!` fetches all three providers each tick, min 30s) + `commands/usage.rs`, `codex.rs`,
   `cursor.rs`. Two real risks: (a) **No request timeout** → a hung TCP connection to one provider stalls
   the whole `join!` and freezes every provider's data + the tray (check whether the `reqwest::Client` sets
   a timeout). (b) **Over-defensive `#[serde(default)]` parsing** (a documented design choice) means a
   provider **API shape change silently yields 0 / empty** instead of an error — so the tray shows "0%
   used / fine" when the user is actually maxed, and they blow the limit. Distinguish "missing field →
   safe default" from "missing field → wrong-but-plausible number". Check the **billing money math**
   (cents / minor-units; negative or overflowing credit; off-by-one in the **Cursor billing-cycle reset
   date**) and the **reset countdown** timezone/DST handling (`resets_at` → `src/utils/format.ts`).

8. **Frontend state, setup flow & secret hygiene** — `src/context/AppContext.tsx` (reducer),
   `src/hooks/useUsageData.ts`, `useHistoryRecorder.ts`, `useAlertEngine.ts`, `useBurnRate.ts`,
   `src/components/setup/*` (`ProviderMethodPicker.tsx`, `MethodCard.tsx`), `src/components/Settings.tsx`,
   `src/components/DebugPanel.tsx`. Check: does the frontend put any token in `localStorage` / log it to
   the console / render it into the DOM? When a save-credential or fetch command **fails**, does the UI
   roll back and **tell the user**, or silently show stale/zero data? Does the `DebugPanel` display raw
   responses containing secrets?

9. **Widget layout migration & persistence** — `src/widget/layout.ts` (the **v1/v2 → v3 layout
   migration**), `src/widget/selectors.ts`, `src/widget/themes.ts`, `src/widget/useWidgetStore.ts`. The
   widget layout is persisted into the **same `credentials.json`** that holds the provider secrets — check
   whether a widget-layout save and a credential save can **race and clobber** each other (last-write-wins
   over the whole store file → lost tokens or lost layout). Does the v1/v2→v3 migration **drop cards /
   settings** a user had configured? Are unknown future keys preserved?

### UX / workflow consistency

10. **Widget click-through & tray interaction** — `src/widget/WidgetOverlay.tsx`, `WidgetCard.tsx`,
    `src-tauri/src/hook.rs` (global mouse hook → `device-mouse-move`), `src-tauri/src/styled_tray.rs` +
    `native_tray.m`. The **header-only hitbox / cards-are-click-through** design is **intentional — do not
    flag it as a bug**. Do check the *correctness* of the hitbox math (the documented screen-px vs
    `getBoundingClientRect()` coordinate-system trap in `docs/widget-click-through-drag.md`) and any
    interaction dead-ends. (See "Prior incidents" — this is a re-check, not a fresh design critique.)

### Performance & scalability

11. **Background loops, mouse-event flood & robustness** — `src-tauri/src/focus_monitor.rs` (macOS
    `AXObserver` window-title polling cadence + the static `Mutex`es `FRONTMOST_*`), `src-tauri/src/hook.rs`
    (does it emit a `device-mouse-move` event on **every** physical mouse move → IPC flood / main-thread
    churn?), `src-tauri/src/process_monitor.rs` (`pgrep`/`ps`/`powershell` shell-outs on a timer),
    `credentials_cache.rs` Mutex contention, and `reqwest::Client` reuse-vs-per-call. Flag `unwrap()`/
    `expect()`/`panic!` reachable in **long-lived loops or startup** (where a panic = crash-on-launch or a
    dead background thread), distinguishing those from genuinely-infallible ones. There are ~36 `unsafe`
    blocks (FFI) and ~128 `unwrap`/`expect` sites — focus on the ones on hot/looping/startup paths, not the
    static-init ones.

## Prior incidents to RE-CHECK (from git log + CLAUDE.md/AGENTS.md/docs)
State, in Appendix A, whether each is still safe or has regressed:
- **Claude "extra usage" reset fallback** and varying extra-usage response shapes (`usage.rs`).
- **MAX 20x usage response shape** handling (Cursor/Claude response variance, `cursor.rs`/`usage.rs`).
- **Cursor billing-cycle reset date** off-by-one (`cursor.rs`).
- **Claude Desktop cookie fallback** and **Claude OAuth → session-key fallback** for usage data
  (`browser.rs`, `claude_oauth.rs`, `usage.rs`).
- **`parse_ps_line` / `SplitN` parsing** robustness on macOS/Windows process lines (`process_monitor.rs`).
- **Single-instance enforcement** (second launch shows the window, doesn't spawn a dup).
- **Widget click-through coordinate conversion** (rdev screen px vs `getBoundingClientRect`) —
  `docs/widget-click-through-drag.md`.
- **Windows widget transparency** dual native+runtime-hook requirement (`CLAUDE.md` "Windows Widget Shadow
  Regression") — only flag a *regression*, not the documented workaround itself.

## DO NOT FLAG — intentional design (per CLAUDE.md / AGENTS.md / docs)
- The local HTTP API server **existing** at all — it's **opt-in** via `http_server_enabled` and documented.
  (You *may* flag its **unauthenticated surface / what it discloses** — that's a separate question.)
- The widget **reusing main-window data flows** instead of a separate backend.
- Widget **cards being click-through** (only the header is a hitbox) — by design; cards are display-only.
- **Defensive `#[serde(default)]` parsing** as a general approach — only flag a *specific* place where it
  produces a wrong-but-plausible number (a correctness bug), not the pattern itself.
- `macOSPrivateApi: true`, **Accessory** dock-hiding, and the **custom native tray bridge**
  (`native_tray.m` / `styled_tray.rs` / `TaoTrayTarget` z-order fix) — intentional and load-bearing.
- The **Windows widget transparency** native-window-config + runtime-hook combination (documented
  regression workaround).
- The single `usage_history` SQLite table being **Claude-only** for now (documented current state).
- Pure style/formatting nits or speculative "could be cleaner" with no concrete failure.

## Output — write `docs/bug-audit/BUG_AUDIT.md`
1. **Title + scope note** (read-only audit; today's date; UsageWatch desktop app; what was/wasn't covered).
2. **Audit plan**: the detected stack and the territories you covered (with paths).
3. **Executive summary**: counts by severity + the **top 5 things to fix first** (one line each w/ `file:line`).
4. **Findings** grouped by severity (critical > high > medium > low), then by lens. Each: title · severity ·
   confidence · location(s) · scenario · impact · fix sketch · verifier note. **Dedupe** same-root-cause
   issues across files into one entry listing all locations.
5. **Appendix A — Prior incidents/gotchas re-checked**: which are still safe vs. regressed.
6. **Appendix B — Explicitly NOT flagged**: intentional gaps you encountered (so they read as considered,
   not missed).
7. **Appendix C — Coverage & gaps**: anything you couldn't fully audit (needed runtime, missing access) and
   what a follow-up pass should target.

Then print the severity counts + the top-5 list as your final chat message.

---

## To run the deeper multi-agent version instead
Ask Claude Code: **"Run the bug-audit workflow at `docs/bug-audit/bug-audit-workflow.mjs`."**
It fans out one finder lane per territory in parallel, adversarially verifies each finding with an
independent skeptic, then synthesizes the same `docs/bug-audit/BUG_AUDIT.md`. Higher coverage, higher token cost.
