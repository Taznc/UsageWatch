# UsageWatch

Tray-first desktop app for monitoring AI provider usage limits across **Claude**, **Codex (OpenAI)**, and **Cursor** — all in one place.

Built with Tauri 2, React, and TypeScript. Lives in your system tray so you always know where you stand before hitting a rate limit.

## What It Does

- Tracks rate-limit percentages, reset timers, billing, and spend for Claude, Codex, and Cursor
- Displays usage in the system tray with styled text — no browser tab needed
- Auto-switches the displayed provider based on your focused app
- Sends native notifications when you approach usage thresholds
- Serves usage data over a local API for Stream Deck and automation integrations
- Exposes usage to Claude Code via a built-in MCP server

## Features

- **Multi-provider monitoring** — Claude (session + weekly + per-model breakdowns), Codex (session + weekly + code review + credits), Cursor (plan spend + on-demand + team pooled budgets)
- **Dynamic tray** — auto-switches displayed provider based on your focused app (macOS + Windows)
- **Multi-segment tray** — show data from multiple providers simultaneously with per-segment color (macOS)
- **Desktop widget** — always-on-top transparent overlay with 6 themes, configurable card order and visibility
- **Alerts** — native notifications at configurable usage thresholds (session %, weekly %, burn rate)
- **Peak hours badge** — shows whether Claude is in peak, off-peak, or weekend mode
- **Extra usage / billing** — prepaid credits, overage grants, bundles, Stripe balance tracking
- **History chart** — 7-day usage history stored in local SQLite
- **MCP server** — expose usage data to Claude Code and other MCP clients
- **Local HTTP API** — Stream Deck / automation integration on port 52700
- **Auto-detect credentials** — scans browsers and desktop apps for session cookies
- **Claude OAuth support** — reads Claude Code credentials from macOS Keychain or credential files

### Widget Themes

The desktop widget supports 6 visual themes: **rainmeter-stack**, **gauge-tower**, **side-rail**, **mono-ticker**, **signal-deck**, and **matrix-rain**. Each theme has configurable density and scale settings.

## Installation

### From Source

Prerequisites:
- Node.js 18+
- Rust (via [rustup](https://rustup.rs))
- Platform build tools — Xcode CLI tools on macOS, Visual Studio Build Tools on Windows

```bash
git clone https://github.com/joshashworth/UsageWatch.git
cd UsageWatch
npm install
npm run tauri dev        # development with hot reload
npm run build            # production build
```

### MCP Server (optional)

The MCP server lets Claude Code (and other MCP clients) query your usage data directly.

```bash
cd mcp-server
npm install
npm run build
```

The `.mcp.json` in the repo root auto-registers the server with Claude Code.

## Setup

On first launch, UsageWatch opens a setup wizard to connect your providers.

For each provider, choose an auth method:
- **Browser scan** — auto-detects session cookies from Chrome, Firefox, Edge, Brave, Arc, Zen, Safari, Vivaldi, Opera, and Chromium
- **Desktop app detection** — reads credentials from Claude Desktop, Codex CLI (`~/.codex/auth.json`), or Cursor's globalStorage
- **Manual token** — paste a session key or bearer token directly
- **Claude OAuth** — reads Claude Code credentials from the macOS Keychain or `~/.claude/.credentials.json`

## Configuration

All settings are accessible from the tray icon's Settings panel.

- **Tray mode** — Static (one provider), Dynamic (auto-switch by focused app), or Multi-segment (multiple providers at once)
- **App mappings** — assign apps and window titles to providers for dynamic switching
- **Widget** — choose a theme, density, and scale; drag-reorder cards; toggle per-provider card visibility
- **Alerts** — session and weekly usage thresholds, burn rate warnings, reset notifications
- **Polling interval** — configurable refresh rate (minimum 30 seconds)

## Local HTTP API

When running, UsageWatch serves cached snapshots on `http://127.0.0.1:52700`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/usage` | GET | Claude usage data |
| `/api/codex` | GET | Codex usage data |
| `/api/cursor` | GET | Cursor usage data |
| `/api/open` | POST | Show/focus the main window |

## MCP Tools

The MCP server exposes these tools to Claude Code and compatible clients:

| Tool | Description |
|------|-------------|
| `get_usage_overview` | Combined summary across all providers |
| `get_claude_usage` | Session/weekly limits, extra usage, peak hours, reset timers |
| `get_codex_usage` | Session/weekly limits, code review, credits, plan type |
| `get_cursor_usage` | Plan spend, on-demand usage, bonus credits, billing cycle |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop framework | Tauri 2.x (Rust backend + webview frontend) |
| Frontend | React 19, TypeScript 5.8, Vite 7, Recharts |
| Backend | Axum (HTTP server), Tokio (async), rookie (browser cookies), reqwest (HTTP client) |
| Storage | tauri-plugin-store (credentials), tauri-plugin-sql (SQLite history) |
| MCP | @modelcontextprotocol/sdk |

## Documentation

- **[AGENTS.md](AGENTS.md)** — architecture, APIs, events, and conventions for coding agents
- **[CLAUDE.md](CLAUDE.md)** — concise guidance for Claude Code
- **[docs/widget-click-through-drag.md](docs/widget-click-through-drag.md)** — transparent widget click-through and drag implementation
- **[docs/cursor-usage-api.md](docs/cursor-usage-api.md)** — Cursor API details and Enterprise meter fix

## License

See the repository's license file if present.
