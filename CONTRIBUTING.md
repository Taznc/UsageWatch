# Contributing to UsageWatch

Thanks for your interest in contributing! This guide covers the basics.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable toolchain)
- Platform build tools:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools (C++ workload)
  - **Linux**: `build-essential`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`

## Getting Started

```bash
# Clone the repo
git clone https://github.com/Taznc/UsageWatch.git
cd UsageWatch

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

The Vite dev server runs on port 1420 and Tauri HMR uses port 1421.

## Project Structure

- `src/` — React frontend (main window + widget)
- `src-tauri/src/` — Rust backend (Tauri commands, polling, tray)
- `widget/` — Widget frontend entry
- `mcp-server/` — MCP server for AI assistant integrations
- `docs/` — Screenshots and supplemental documentation

See [CLAUDE.md](CLAUDE.md) for detailed architecture notes.

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Test locally with `npm run tauri dev`
4. Verify the Rust build: `cargo build --manifest-path src-tauri/Cargo.toml`
5. Open a pull request with a clear description of what changed and why

## Code Style

- **TypeScript**: Follow existing patterns in `src/`. No special linter config — just match what's there.
- **Rust**: Standard `rustfmt` formatting. Run `cargo fmt` before committing.
- Keep commits focused and descriptive.

## Reporting Issues

Use [GitHub Issues](https://github.com/Taznc/UsageWatch/issues) to report bugs or request features. Include:

- What you expected vs. what happened
- Your OS and version
- Steps to reproduce (if applicable)
