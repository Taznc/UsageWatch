export const meta = {
  name: 'bug-audit',
  description: 'Extensive read-only bug/security audit of UsageWatch (Tauri 2: Rust backend + React webview, local HTTP API, MCP server, multi-source credential harvesting). Find → adversarially verify → synthesize a severity-ranked report at docs/bug-audit/BUG_AUDIT.md. Touches no product code.',
  whenToUse: 'Run when you want a deep, multi-agent correctness/security/UX/perf sweep of the UsageWatch desktop app. Read-only.',
  phases: [
    { title: 'Find', detail: 'Parallel finders sweep code territories, each with a primary lens' },
    { title: 'Verify', detail: 'Independent skeptic adversarially verifies each finding (refute by default)' },
    { title: 'Synthesize', detail: 'Dedupe, severity-rank, write docs/bug-audit/BUG_AUDIT.md' },
  ],
}

// ============================================================================
// UsageWatch — extensive bug audit (READ-ONLY)
// Stack: Tauri 2 desktop app. Rust backend (src-tauri/src/*) + React/TS webview
// (src/*) + local HTTP API on 127.0.0.1:52700 + an MCP server (mcp-server/*) +
// a Stream Deck plugin. Tracks Claude/Codex/Cursor usage. Reads + refreshes
// credentials from browsers, the Keychain, and other apps' files.
// Lenses (weighted): 1) Security & data integrity  2) Correctness/logic
//                    3) UX/workflow consistency     4) Performance
// Output: a severity-ranked markdown report. NO code changes, NO commits.
// ============================================================================

// ---- Shared context every agent receives -----------------------------------
// Embedded so finders go straight to the high-blast-radius code and don't
// re-flag intentional design. Keep in sync with CLAUDE.md / AGENTS.md / docs/.

const REPO = '/Users/joshashworth/Projects/UsageWatch'

const GROUND_RULES = `
You are auditing the "UsageWatch" codebase at ${REPO} for an EXTENSIVE bug/security review.
UsageWatch is a Tauri 2 DESKTOP app: a Rust backend (src-tauri/src/*) + a React/TypeScript webview
(src/*). It tracks AI usage limits for Claude, Codex/OpenAI, and Cursor, lives in the system tray, shows
an always-on-top transparent widget, exposes data over a local HTTP API on 127.0.0.1:52700 (Stream Deck),
ships an MCP server (mcp-server/*), and reads + refreshes credentials from many sources.

THREAT MODEL (this is a single-user LOCAL desktop app — NOT a multi-tenant server)
There is NO login, NO tenants, NO forced-logout. Do NOT hunt for "cross-tenant/cross-household leak" — it
does not apply. The crown jewels, in priority order:
1. HARVESTED PROVIDER CREDENTIALS: the app reads Claude/Codex/Cursor session keys, cookies, OAuth + refresh
   tokens from 10+ browsers, the macOS Keychain, and other apps' files (Claude Desktop, ChatGPT Desktop,
   Cursor globalStorage, ~/.codex/auth.json, ~/.claude/.credentials.json). Any path that LEAKS these (logs,
   the local HTTP API, the webview IPC surface, the SQLite history, plaintext stores) or EXFILTRATES them
   is top severity.
2. INTEGRITY OF FILES IT WRITES BACK INTO OTHER TOOLS: on OAuth refresh it REWRITES Claude Code's own
   ~/.claude/.credentials.json / Keychain item and Codex's ~/.codex/auth.json, and it EDITS users' MCP host
   configs (Claude Desktop / Cursor / Codex). A non-atomic or wrong write CORRUPTS a different program's
   auth/config — cross-app data loss.
3. LOCAL CODE EXECUTION: the Rust side spawns OS processes (osascript, open, taskkill, a lowercased binary
   name, security). Any interpolation of an attacker- or config-controlled string into a shell/AppleScript
   command is RCE / command injection.
4. CRASH / DATA-DROPPING MIGRATION: crash-on-launch (panics on startup paths) and the widget-layout
   v1/v2 -> v3 migration silently dropping a user's saved layout/config.

CRITICAL CONSTRAINTS
- READ-ONLY. Do NOT edit, write, generate, or refactor any product code. Do NOT run git mutations, installs,
  cargo/npm builds, migrations, or deploys.
- Read-only shell is fine (grep/rg, cat, sed -n, git log/blame/show/diff, ls, find, lockfile inspection,
  --dry-run/--help). Build/run is NOT required.

EVIDENCE BAR (every finding MUST have)
- file:line reference(s) you actually read.
- A concrete, REACHABLE failure scenario / repro — not a vibe ("this looks fragile" is not a finding).
  It must be reachable on a shipping path: NOT #[cfg(test)], NOT a doc example, NOT dev-only.
- Why it matters (user-visible impact or security/data consequence).
- A one-line fix sketch (what to change — but DO NOT apply it).
- A confidence: high | medium | low. Be honest; low-confidence items are allowed but labeled.

SEVERITY RUBRIC (tuned for a local desktop app)
- critical: local RCE / command injection; arbitrary exfiltration of harvested provider credentials;
  corruption of ANOTHER tool's credential/config file (breaks Claude Code / Codex / Cursor auth); a secret
  written somewhere world-readable or to shipping logs; crash-on-launch; a migration that drops user
  data/config.
- high: unauthenticated local exposure of secrets or spend data; silent WRONG-usage display that makes the
  user blow past a real limit (e.g. shows 0% when actually maxed); partial-write corruption of the app's own
  store; cross-app config clobber that deletes the user's OTHER MCP servers.
- medium: logic bug with a workaround; parsing gap that shows a wrong number; UX dead-end / silent failure;
  perf cliff under realistic use.
- low: edge-case bug, minor inconsistency, defensive-coding gap, low-impact info disclosure.

PRIOR INCIDENTS TO RE-CHECK (from git log + CLAUDE.md/AGENTS.md/docs — say still-safe vs regressed)
- Claude "extra usage" reset fallback + varying extra-usage response shapes (commands/usage.rs).
- "MAX 20x" usage response shape handling (commands/cursor.rs / usage.rs).
- Cursor billing-cycle reset date off-by-one (commands/cursor.rs).
- Claude Desktop cookie fallback + Claude OAuth -> session-key fallback (browser.rs, claude_oauth.rs, usage.rs).
- parse_ps_line / SplitN parsing robustness on process lines (process_monitor.rs).
- Single-instance enforcement (second launch shows window, no dup).
- Widget click-through coordinate conversion (rdev screen px vs getBoundingClientRect) — docs/widget-click-through-drag.md.
- Windows widget transparency dual native+runtime-hook requirement (CLAUDE.md) — flag only a REGRESSION, not the workaround.

DO NOT FLAG (intentional design per CLAUDE.md / AGENTS.md / docs — these are NOT bugs)
- The local HTTP API server EXISTING — it is opt-in via http_server_enabled and documented. (You MAY flag
  its unauthenticated surface / what it discloses — that is a separate question.)
- The widget reusing main-window data flows instead of a separate backend.
- Widget cards being click-through (only the header is a hitbox) — by design; cards are display-only.
- Defensive #[serde(default)] parsing AS A PATTERN — only flag a SPECIFIC place where it yields a
  wrong-but-plausible number (a correctness bug), not the approach itself.
- macOSPrivateApi: true, Accessory dock-hiding, and the custom native tray bridge (native_tray.m /
  styled_tray.rs / TaoTrayTarget z-order fix) — intentional and load-bearing.
- The Windows widget transparency native-window-config + runtime-hook combination (documented workaround).
- The single usage_history SQLite table being Claude-only for now (documented current state).
- Pure style nits or speculative "could be cleaner" with no concrete failure.
`

// ---- Finder lanes: each = a code territory + a primary lens ------------------
// Specific, verified entry points beat "go find bugs". Each finder returns
// structured findings via FINDINGS_SCHEMA.

const FINDERS = [
  {
    key: 'sec-http',
    label: 'security:local-http-api',
    lens: 'Security & data integrity',
    prompt: `LANE: The local HTTP API server.
Read closely:
- src-tauri/src/http_server.rs: binds 127.0.0.1:52700 (~line 56); routes GET /api/usage|/api/codex|
  /api/cursor|/api/billing + POST /api/open (~lines 47-54); CorsLayer (~lines 39-45) only restricts BROWSER
  origins; handlers do .lock().unwrap() (lines 74,83,92,101).
- src-tauri/src/polling.rs + src-tauri/src/models.rs: the UsageUpdate / BillingUpdate / CodexUpdate /
  CursorUpdate payload shapes returned by those routes.
Determine: (a) do the JSON payloads ever include the session key / bearer / OAuth token itself, or only
derived usage numbers? (b) can ANY local process (curl, another app — CORS does not stop non-browser
clients; consider DNS-rebinding for a browser) read spend/billing data or focus-steal via POST /api/open?
(c) does a poisoned mutex (.lock().unwrap()) panic the server task and how does that degrade?
The server is OPT-IN (documented) — do NOT flag that it exists; DO flag unauthenticated disclosure of
secrets/spend, focus-stealing, or panics.
Report exposure-of-secrets, unauthenticated-action, and robustness findings.`,
  },
  {
    key: 'sec-procspawn',
    label: 'security:process-spawn-injection',
    lens: 'Security & data integrity',
    prompt: `LANE: Process spawning / command + AppleScript injection.
Read closely:
- src-tauri/src/process_monitor.rs: line ~438 osascript -e 'tell application "{name}" to quit' interpolates
  {name} INTO an AppleScript string; line ~494 (Linux) Command::new(&lower) launches a binary named by the
  lowercased app name; Windows paths Command::new(&path) (~360/386), taskkill, reg, explorer.exe.
- TRACE every caller of kill_by_image / launch_app_named / restart_app_named back to its source: MCP host
  restart (commands/mcp.rs mcp_restart_host), tray/app-mapping config, or a hardcoded enum? If {name} can
  contain a quote / newline / "do shell script", that is AppleScript injection -> RCE.
- Confirm the Keychain "security" calls (commands/codex.rs:65/85/88, commands/claude_oauth.rs:72/100/104)
  and Windows reg/taskkill calls pass ONLY fixed args, never interpolated user/config strings.
Report command-injection / RCE / unintended-process-launch findings, each with the data flow from source
of {name} to the spawn site.`,
  },
  {
    key: 'sec-credstore',
    label: 'security:credential-storage+leak',
    lens: 'Security & data integrity',
    prompt: `LANE: Credential storage at rest + secret leakage.
Read closely:
- src-tauri/src/commands/credentials.rs: save_to_store (line 7) writes session_key/org_id/codex_manual_token/
  cursor_manual_token to credentials.json in PLAINTEXT via tauri-plugin-store, while Claude OAuth uses the
  Keychain. Is the plaintext-vs-Keychain split defensible? Is the file mode restrictive?
- Sweep for secrets in logs: eprintln!/println!/log::/dbg! printing a cookie, session key, bearer/OAuth
  token, or a raw API response containing one — in commands/usage.rs, codex.rs, cursor.rs, browser.rs, and
  the debug_* commands (debug_claude_api, debug_claude_api_raw, debug_claude_desktop_cookies, debug_cursor_api).
- Does usage_history.db (SQLite) store anything sensitive?
- Do get_session_key / get_codex_token / get_cursor_token / check_claude_oauth hand raw secrets to the
  webview where injected script could read them? Assess against the CSP in src-tauri/tauri.conf.json.
Report at-rest-plaintext, secret-in-logs, and secret-to-webview findings.`,
  },
  {
    key: 'sec-harvest',
    label: 'security:credential-harvest',
    lens: 'Security & data integrity',
    prompt: `LANE: Credential harvesting from browsers / Keychain / other apps.
Read closely:
- src-tauri/src/commands/browser.rs: pull_session_from_browsers (L166), pull_codex_session_from_browsers
  (L364), scan_browsers, debug_claude_desktop_cookies (L88). Uses the rookie crate to decrypt cookie DBs
  and a TEMP-FILE COPY for locked DBs.
- src-tauri/src/commands/codex.rs (check_codex_auth ~L125: ~/.codex/auth.json / $CODEX_HOME / Keychain),
  commands/cursor.rs (Cursor globalStorage storage.json / Windows state.vscdb), commands/claude_oauth.rs.
Check: are temp copies of cookie databases CLEANED UP, or do plaintext-decryptable cookie DBs linger in a
temp dir? Are decryption / parse failures handled WITHOUT panicking (these run in the poll loop)? Is the
scan scope wider than the documented opt-in discovery implies (privacy)?
Report leftover-decrypted-data, panic-on-malformed, and scope/consent findings.`,
  },
  {
    key: 'sec-writeback',
    label: 'security:cross-app-credential-writeback',
    lens: 'Security & data integrity',
    prompt: `LANE: Writing credentials BACK into other tools' files (highest cross-app blast radius).
Read closely:
- src-tauri/src/commands/claude_oauth.rs: get_claude_oauth_token (~L190) refreshes the Claude Code OAuth
  token (POST api.anthropic.com/auth/token/refresh) and writes the result back to Claude Code's OWN Keychain
  item / ~/.claude/.credentials.json.
- src-tauri/src/commands/codex.rs: rewrites ~/.codex/auth.json + the "Codex Auth" Keychain item on refresh.
Verify: (a) is each write ATOMIC (temp + rename), so a crash / partial write can't corrupt the file and
break Claude Code / Codex auth? (b) is the 5-minute "near expiry" refresh logic correct — no premature
refresh invalidating a still-valid token, no missed refresh? (c) can the POLL LOOP refresh RACE a MANUAL
refresh and double-rotate a single-use refresh token, locking the user out of the other tool?
Report file-corruption, refresh-race, and token-rotation findings.`,
  },
  {
    key: 'sec-mcpconfig',
    label: 'security:mcp-config-management',
    lens: 'Security & data integrity',
    prompt: `LANE: MCP host config read/write.
Read closely:
- src-tauri/src/commands/mcp.rs (~1450 lines; commands at L1110-1432: mcp_add_server, mcp_remove_server,
  mcp_copy_server, mcp_set_enabled, mcp_set_enabled_bulk, mcp_register_project, mcp_unregister_project,
  mcp_restart_host, mcp_list_servers_unified, mcp_preview_translation, …). It READS AND REWRITES users' real
  MCP config files for Claude Desktop / Cursor / Codex, with atomic temp+rename and a first-edit backup to
  <app_data>/mcp-backups/.
Verify: (a) round-tripping the config PRESERVES unknown keys and the user's OTHER MCP servers (no clobber
-> data loss); (b) the backup is written BEFORE the first mutation and is actually restorable; (c) config-
path discovery can't be redirected via symlink / ".." path traversal; (d) bulk enable/disable can't drop
entries on a partial failure.
Report config-clobber/data-loss, backup-correctness, and path-traversal findings.`,
  },
  {
    key: 'corr-polling',
    label: 'correctness:polling+parsing+money',
    lens: 'Correctness / logic',
    prompt: `LANE: Unified polling, defensive parsing, billing math, reset countdowns.
Read closely:
- src-tauri/src/polling.rs (poll_all_providers: one loop, tokio::join! fetches all three each tick, min 30s)
  + commands/usage.rs, codex.rs, cursor.rs.
Two real risks:
(a) NO REQUEST TIMEOUT -> a hung TCP connection to one provider stalls the whole join! and freezes EVERY
    provider's data + the tray. Check whether the reqwest::Client sets a timeout.
(b) Over-defensive #[serde(default)] parsing means a provider API SHAPE CHANGE silently yields 0/empty
    instead of an error -> the tray shows "0% used / fine" when the user is actually MAXED, and they blow
    the limit. Distinguish "missing field -> safe default" from "missing field -> wrong-but-plausible number".
Also check: billing money math (cents / minor-units; negative or overflowing credit; off-by-one in the
Cursor billing-cycle reset date) and the reset-countdown timezone/DST handling (resets_at -> src/utils/format.ts).
Re-check the prior incidents: extra-usage reset fallback, MAX 20x response shape, Cursor billing-cycle date.
Report stall, silent-wrong-number, money-math, and date/timezone findings.`,
  },
  {
    key: 'corr-frontend',
    label: 'correctness:frontend-state+secrets',
    lens: 'Correctness / logic',
    prompt: `LANE: Frontend state, setup flow, and secret hygiene.
Read closely:
- src/context/AppContext.tsx (reducer), src/hooks/useUsageData.ts, useHistoryRecorder.ts, useAlertEngine.ts,
  useBurnRate.ts; src/components/setup/* (ProviderMethodPicker.tsx, MethodCard.tsx); src/components/Settings.tsx;
  src/components/DebugPanel.tsx.
Check: does the frontend put any token in localStorage / log it to the console / render it into the DOM?
When a save-credential or fetch command FAILS, does the UI roll back and TELL the user, or silently show
stale/zero data (which, combined with the parsing lane, could mask a maxed limit)? Does DebugPanel display
raw responses containing secrets? Any optimistic-update-without-rollback or double-submit on credential save?
Report secret-in-frontend, silent-failure, and state-inconsistency findings.`,
  },
  {
    key: 'corr-widget',
    label: 'correctness:widget-layout-migration',
    lens: 'Correctness / logic',
    prompt: `LANE: Widget layout migration + persistence (data-loss risk).
Read closely:
- src/widget/layout.ts (the v1/v2 -> v3 layout MIGRATION), src/widget/selectors.ts, src/widget/themes.ts,
  src/widget/useWidgetStore.ts.
The widget layout is persisted into the SAME credentials.json that holds the provider secrets. Check:
(a) can a widget-layout save and a credential save RACE and clobber each other (last-write-wins over the
    whole store file -> lost tokens or lost layout)?
(b) does the v1/v2 -> v3 migration DROP cards / settings a user had configured?
(c) are unknown future keys preserved across a migration round-trip?
Report store-clobber, migration-data-loss, and layout-normalization findings.`,
  },
  {
    key: 'ux-widget-tray',
    label: 'ux:widget-clickthrough+tray',
    lens: 'UX workflow consistency',
    prompt: `LANE: Widget click-through correctness + tray interaction.
Read closely:
- src/widget/WidgetOverlay.tsx, WidgetCard.tsx; src-tauri/src/hook.rs (global mouse hook -> device-mouse-move);
  src-tauri/src/styled_tray.rs + native_tray.m; docs/widget-click-through-drag.md.
The header-only hitbox / cards-are-click-through design is INTENTIONAL — do NOT flag it as a bug. DO check
the CORRECTNESS of the hitbox math (the documented screen-px vs getBoundingClientRect() coordinate-system
trap), drag/resize edge cases, and any interaction dead-end (e.g. a state where the widget can't be moved or
the popover can't be dismissed). Treat the documented coordinate-conversion gotcha as a RE-CHECK.
Report hitbox-correctness, drag/dismiss dead-end, and interaction-state findings — not design critiques.`,
  },
  {
    key: 'perf-loops',
    label: 'performance:background-loops+robustness',
    lens: 'Performance',
    prompt: `LANE: Background loops, mouse-event flood, and crash-on-loop robustness.
Read closely:
- src-tauri/src/focus_monitor.rs (macOS AXObserver window-title polling cadence + static Mutexes FRONTMOST_*),
  src-tauri/src/hook.rs (does it emit a device-mouse-move IPC event on EVERY physical mouse move -> IPC flood /
  main-thread churn while the widget is shown?), src-tauri/src/process_monitor.rs (pgrep/ps/powershell shell-
  outs on a timer), src-tauri/src/credentials_cache.rs (Mutex contention), reqwest::Client reuse-vs-per-call.
Flag unwrap()/expect()/panic! reachable in LONG-LIVED LOOPS or STARTUP (where a panic = crash-on-launch or a
dead background thread), distinguishing those from genuinely-infallible ones. There are ~36 unsafe blocks
(FFI) and ~128 unwrap/expect sites — focus on hot/looping/startup paths, NOT static-init ones.
Report event-flood, timer-cost, contention, and panic-in-loop findings with the load/trigger condition.`,
  },
]

// ---- JSON schemas for structured agent output -------------------------------

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'confidence', 'locations', 'scenario', 'impact', 'fixSketch', 'lens'],
        properties: {
          title: { type: 'string', description: 'One-line summary of the issue' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          lens: { type: 'string', description: 'security|correctness|ux|performance' },
          locations: { type: 'array', items: { type: 'string' }, description: 'file:line references actually read' },
          scenario: { type: 'string', description: 'Concrete, reachable failure scenario / repro steps' },
          impact: { type: 'string', description: 'User-visible or security/data consequence' },
          fixSketch: { type: 'string', description: 'One-line fix direction (DO NOT apply)' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'adjustedSeverity', 'confidence', 'reasoning'],
  properties: {
    isReal: { type: 'boolean', description: 'true only if the bug genuinely exists after re-reading the code' },
    adjustedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'invalid'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string', description: 'What you checked; why confirmed or refuted; cite file:line' },
    correction: { type: 'string', description: 'Optional: corrected detail if the finding was partly wrong' },
  },
}

// ---- Text-JSON bridge (Opus-4.8-safe) ---------------------------------------
// Opus 4.8 does not reliably call the harness's forced StructuredOutput tool, so
// the {schema} option fails the WHOLE agent ("completed without calling
// StructuredOutput"). Instead we ask each agent to EMIT a JSON value as its final
// message and parse it here. extractJson tolerates ```code fences```, surrounding
// prose, and bare arrays; it respects string literals so braces/brackets inside
// string values do not break delimiter matching.

function scanJson(hay) {
  let start = -1, openCh = '', closeCh = ''
  for (let i = 0; i < hay.length; i++) {
    if (hay[i] === '{') { start = i; openCh = '{'; closeCh = '}'; break }
    if (hay[i] === '[') { start = i; openCh = '['; closeCh = ']'; break }
  }
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < hay.length; i++) {
    const ch = hay[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) { try { return JSON.parse(hay.slice(start, i + 1)) } catch { return null } }
    }
  }
  return null
}

function extractJson(text) {
  if (typeof text !== 'string') return null
  // Try each fenced block first (there may be multiple; try them all before falling back)
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi
  let m
  while ((m = fenceRe.exec(text)) !== null) {
    const r = scanJson(m[1])
    if (r !== null) return r
  }
  // Fall back: scan the full text for the first balanced JSON value
  return scanJson(text)
}

// Append to a prompt: tell the agent to return ONLY a JSON value matching `schema`.
// "First character must be {" closes the loophole where agents write a preamble sentence.
const jsonInstruction = (schema) =>
  `\n\n=== OUTPUT FORMAT — MANDATORY ===\n` +
  `Your response must be RAW JSON and NOTHING ELSE.\n` +
  `- The VERY FIRST CHARACTER of your response must be \`{\` (or \`[\` for an array).\n` +
  `- NO prose before the JSON. NO prose after the JSON. NO markdown code fences.\n` +
  `- Do NOT call any tool. Just output the JSON value directly.\n` +
  `- Field names and enum values must match exactly:\n${JSON.stringify(schema)}\n` +
  `START YOUR RESPONSE WITH \`{\` NOW.`

// ---- Run --------------------------------------------------------------------

log(`UsageWatch bug audit: ${FINDERS.length} finder lanes → adversarial verify → docs/bug-audit/BUG_AUDIT.md`)

// Phases 1+2 pipelined: each lane's findings get verified as soon as that lane
// returns, so fast lanes don't wait on slow ones. No barrier before verification.
// Agents return JSON as TEXT (no forced-tool schema) and we parse it here, so the
// pipeline is robust across models including Opus 4.8.
let finderParseFails = 0, verifierParseFails = 0
const perLane = await pipeline(
  FINDERS,
  async (f) => {
    const raw = await agent(
      `${GROUND_RULES}\n\n=== YOUR LANE ===\nPrimary lens: ${f.lens}\n${f.prompt}\n\nAudit ONLY this lane, but be exhaustive within it. Read the actual files. Return ALL real findings; return an empty findings array if there are none — do NOT invent issues.${jsonInstruction(FINDINGS_SCHEMA)}`,
      { label: `find:${f.label}`, phase: 'Find' })
    const parsed = extractJson(raw)
    let findings = []
    if (Array.isArray(parsed)) findings = parsed
    else if (parsed && Array.isArray(parsed.findings)) findings = parsed.findings
    else if (parsed && parsed.title) findings = [parsed]
    else if (raw && raw.trim()) { finderParseFails++; log(`⚠ find:${f.label} output did not parse — lane findings lost`) }
    return { lane: f.key, findings }
  },
  (result, f) => {
    const findings = (result && result.findings) || []
    if (findings.length === 0) return { lane: f.key, verified: [] }
    return parallel(
      findings.map((finding) => () =>
        agent(`${GROUND_RULES}\n\n=== ADVERSARIAL VERIFICATION ===\nAnother agent reported this finding in lane "${f.label}". Your job is to REFUTE it. Re-read the cited code yourself and default to skepticism: only confirm if the bug genuinely exists and the scenario is reachable on a shipping path. Downgrade severity if overstated. Mark adjustedSeverity="invalid" if it is intended behavior, already guarded elsewhere, on a non-shipping path (#[cfg(test)] / doc example / dev-only), or a DO-NOT-FLAG intentional design.\n\nFINDING:\n${JSON.stringify(finding, null, 2)}${jsonInstruction(VERDICT_SCHEMA)}`,
          { label: `verify:${String(finding.title).slice(0, 40)}`, phase: 'Verify' })
          .then((raw) => {
            let v = extractJson(raw)
            if (Array.isArray(v)) v = v[0]
            if (!v || typeof v.isReal !== 'boolean') { verifierParseFails++; return null }
            return { finding, verdict: v }
          })
          .catch(() => null)),
    ).then((vs) => ({ lane: f.key, verified: vs.filter(Boolean) }))
  },
)

// Collect confirmed findings (verifier says real AND not downgraded to invalid).
const confirmed = []
for (const lane of perLane.filter(Boolean)) {
  for (const v of lane.verified) {
    if (v && v.verdict && v.verdict.isReal && v.verdict.adjustedSeverity !== 'invalid') {
      confirmed.push({
        ...v.finding,
        severity: v.verdict.adjustedSeverity || v.finding.severity,
        verifierConfidence: v.verdict.confidence,
        verifierReasoning: v.verdict.reasoning,
        correction: v.verdict.correction || '',
      })
    }
  }
}

if (finderParseFails || verifierParseFails)
  log(`Parse-fallback notes: ${finderParseFails} finder lane(s) and ${verifierParseFails} verdict(s) were unparseable and skipped.`)
log(`Verification complete: ${confirmed.length} confirmed findings. Synthesizing report...`)

// Phase 3: synthesizer generates the report markdown as text, then a dedicated
// writer agent writes it. Splitting these is more reliable than asking one agent
// to both reason and write a file — single-task agents are more predictable.
phase('Synthesize')
const SEV_ORDER = JSON.stringify(['critical', 'high', 'medium', 'low'])
const reportMarkdown = await agent(
  `${GROUND_RULES}\n\n=== SYNTHESIS ===\nYou are given ${confirmed.length} verified findings as JSON. Produce a single markdown report. Return the markdown as your response text — do NOT write any files, do NOT call any tools.\n\nReport structure:\n1. Title + one-line scope note (read-only audit; UsageWatch Tauri desktop app; what was/wasn't covered).\n2. Audit plan: the detected stack and the territories covered (with paths).\n3. Executive summary: counts by severity; the TOP 5 things to fix first (1 line each, with file:line).\n4. Findings grouped by severity (${SEV_ORDER}), then by lens. For each: title, severity, confidence, location(s), scenario, impact, fix sketch, and the verifier's note/correction.\n5. DEDUPE aggressively: merge findings that are the same root cause across files into one entry listing all locations.\n6. Appendix A — "Prior incidents re-checked": which documented landmines are still safe vs. regressed.\n7. Appendix B — "Explicitly NOT flagged": the intentional designs you encountered (so they read as considered, not missed).\n8. Appendix C — "Coverage & gaps": what couldn't be fully audited (needed runtime / missing access) and what a follow-up pass should target.\n\nBe precise and skimmable. Do not pad. Return ONLY the full markdown document.\n\nVERIFIED FINDINGS JSON:\n${JSON.stringify(confirmed, null, 2)}`,
  { label: 'synthesize:report', phase: 'Synthesize' },
)

// Dedicated file-writer agent: single task, no reasoning needed.
if (reportMarkdown && reportMarkdown.trim().length > 100) {
  await agent(
    `Write the following markdown content EXACTLY to the file ${REPO}/docs/bug-audit/BUG_AUDIT.md using the Write tool. Do not modify the content in any way. Do not output anything else — just call the Write tool with the exact content below and then stop.\n\nCONTENT:\n${reportMarkdown}`,
    { label: 'write:BUG_AUDIT.md', phase: 'Synthesize' },
  )
} else {
  log('⚠ Synthesizer returned empty/short content — skipping file write.')
}

return {
  confirmedCount: confirmed.length,
  bySeverity: confirmed.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {}),
  reportPath: 'docs/bug-audit/BUG_AUDIT.md',
}
