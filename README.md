# UsageWatch

Tray-first desktop app (Tauri 2 + React + TypeScript) for monitoring usage limits across **Claude**, **Codex**, and **Cursor**. Product metadata may still reference the older name “Claude Usage Tracker.”

## Quick start

```bash
npm install
npm run tauri dev
```

Production build:

```bash
npm run build
```

Rust only:

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

## Documentation

- **[AGENTS.md](AGENTS.md)** — architecture, APIs, events, and conventions for coding agents.
- **[CLAUDE.md](CLAUDE.md)** — shorter variant of the same guidance for Claude Code.
- **[docs/widget-click-through-drag.md](docs/widget-click-through-drag.md)** — transparent widget, click-through, and drag coordinate pipeline.
- **[docs/cursor-usage-api.md](docs/cursor-usage-api.md)** — Cursor `usage-summary` + Connect RPC, Enterprise meter fix, and debugging.

## Local HTTP API

When running, UsageWatch serves cached snapshots on `http://127.0.0.1:52700`:

- `GET /api/usage` — Claude
- `GET /api/codex` — Codex
- `GET /api/cursor` — Cursor
- `POST /api/open` — show/focus main window

## License

See the repository’s license file if present.
