# Changelog

## 0.1.0 — Initial Release

### Features

- **Claude monitoring** — 5-hour session and 7-day weekly rate-limit tracking, per-model breakdowns (Opus, Sonnet, Haiku), prepaid credits, overage grants, bundles, and peak/off-peak status
- **Codex monitoring** — session and weekly rate limits, code review window, credit balance, and plan type
- **Cursor monitoring** — plan spend, on-demand/API usage, team pooled budgets, bonus credits, Stripe balance, and billing cycle
- **System tray** — styled usage percentages and reset countdowns in the macOS menu bar; tooltip on Windows
- **Desktop widget** — always-on-top transparent overlay with 6 visual themes (Rainmeter Stack, Gauge Tower, Side Rail, Mono Ticker, Signal Deck, Matrix Rain)
- **Context-aware switching** — tray and widget auto-switch providers based on focused app (macOS + Windows)
- **Zero-config auth** — auto-detects credentials from 10+ browsers, desktop apps, and OAuth sources
- **Alerts** — native notifications for session/weekly thresholds, burn rate warnings, and limit reset events
- **Usage history** — 7-day SQLite-backed history with interactive chart
- **MCP server** — exposes live usage data to Claude Code, Cursor, and other MCP-compatible clients
- **Local HTTP API** — automation-ready endpoints on port 52700
