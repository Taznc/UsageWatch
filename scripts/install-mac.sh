#!/usr/bin/env bash
# Build UsageWatch and install it to /Applications, overwriting any existing copy.
#
# Usage:
#   npm run install:mac                   # native-arch build, relaunch after install
#   npm run install:mac -- --universal    # build a universal (Intel + Apple Silicon) bundle
#   npm run install:mac -- --no-launch    # don't auto-launch after install
#   npm run install:mac -- --dry-run      # print actions without doing them
#
# Note: this produces an unsigned bundle. The quarantine attribute is stripped
# after copy so Gatekeeper won't block the first launch.

set -euo pipefail

APP_NAME="UsageWatch"
BUNDLE_ID="com.joshashworth.usagewatch"
INSTALL_PATH="/Applications/${APP_NAME}.app"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

UNIVERSAL=0
LAUNCH=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --no-launch) LAUNCH=0 ;;
    --dry-run)   DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  (dry-run) %s\n' "$*"
  else
    eval "$@"
  fi
}

# ── 1. Quit any running instance ─────────────────────────────────────────────
if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  log "Quitting running ${APP_NAME}…"
  run "osascript -e 'tell application \"${APP_NAME}\" to quit' >/dev/null 2>&1 || true"
  # Give the single-instance lock + tray cleanup ~2s
  sleep 2
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    log "Force-killing stragglers…"
    run "pkill -x '${APP_NAME}' || true"
    sleep 1
  fi
fi

# ── 2. Build ─────────────────────────────────────────────────────────────────
if [ "$UNIVERSAL" -eq 1 ]; then
  log "Building universal bundle (Intel + Apple Silicon)…"
  if ! rustup target list --installed 2>/dev/null | grep -q '^aarch64-apple-darwin$'; then
    log "Installing rustup target aarch64-apple-darwin…"
    run "rustup target add aarch64-apple-darwin"
  fi
  if ! rustup target list --installed 2>/dev/null | grep -q '^x86_64-apple-darwin$'; then
    log "Installing rustup target x86_64-apple-darwin…"
    run "rustup target add x86_64-apple-darwin"
  fi
  run "npm run tauri build -- --target universal-apple-darwin"
  BUILT_APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}.app"
else
  log "Building native-arch bundle…"
  run "npm run tauri build"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  TARGET_DIR="aarch64-apple-darwin" ;;
    x86_64) TARGET_DIR="x86_64-apple-darwin" ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  # Tauri sometimes places the bundle under the target triple, sometimes directly
  # under target/release — try the triple-prefixed path first, fall back to bare.
  BUILT_APP="src-tauri/target/${TARGET_DIR}/release/bundle/macos/${APP_NAME}.app"
  if [ ! -d "$BUILT_APP" ] && [ "$DRY_RUN" -eq 0 ]; then
    BUILT_APP="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
  fi
fi

if [ "$DRY_RUN" -eq 0 ] && [ ! -d "$BUILT_APP" ]; then
  echo "Build succeeded but bundle not found at: $BUILT_APP" >&2
  echo "Look under src-tauri/target/*/release/bundle/macos/ to locate it." >&2
  exit 1
fi
log "Built bundle: $BUILT_APP"

# ── 3. Replace /Applications copy ────────────────────────────────────────────
if [ -d "$INSTALL_PATH" ]; then
  log "Removing existing ${INSTALL_PATH}…"
  run "rm -rf '${INSTALL_PATH}'"
fi

log "Copying to ${INSTALL_PATH}…"
run "cp -R '${BUILT_APP}' '${INSTALL_PATH}'"

# ── 4. Strip Gatekeeper quarantine (unsigned build) ──────────────────────────
log "Stripping quarantine attribute…"
run "xattr -dr com.apple.quarantine '${INSTALL_PATH}' 2>/dev/null || true"

# ── 5. Refresh Launch Services so Spotlight/Open With see the new bundle ─────
run "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f '${INSTALL_PATH}' 2>/dev/null || true"

# ── 6. Launch ────────────────────────────────────────────────────────────────
if [ "$LAUNCH" -eq 1 ]; then
  log "Launching ${APP_NAME}…"
  run "open '${INSTALL_PATH}'"
fi

log "Done. ${APP_NAME} is installed at ${INSTALL_PATH}."
