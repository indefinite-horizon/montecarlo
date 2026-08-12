#!/usr/bin/env bash
# Launches a built macOS app with a deterministic Codex protocol fixture and
# verifies a UI turn survives a renderer reload.

set -euo pipefail
cd "$(dirname "$0")/.."

app_path="${1:-}"
if [[ -z "$app_path" ]]; then
  if [[ -d dist/desktop/mac-universal/montecarlo.app ]]; then
    app_path="dist/desktop/mac-universal/montecarlo.app"
  else
    app_path="$(find dist/desktop -type d -iname 'montecarlo.app' -print -quit)"
  fi
fi
if [[ -z "$app_path" || ! -d "$app_path" ]]; then
  echo "Error: the packaged Monte Carlo.app was not found." >&2
  exit 1
fi
app_path="$(cd "$(dirname "$app_path")" && pwd)/$(basename "$app_path")"

executable="$app_path/Contents/MacOS/montecarlo"
if [[ ! -x "$executable" ]]; then
  echo "Error: the packaged desktop executable is missing." >&2
  exit 1
fi

temporary_parent="${RUNNER_TEMP:-/tmp}"
smoke_root="$(mktemp -d "$temporary_parent/montecarlo-packaged-smoke.XXXXXX")"
cleanup() {
  rm -rf "$smoke_root"
}
trap cleanup EXIT

fake_codex="$smoke_root/fake-codex"
user_data="$smoke_root/user-data"
node_executable="$(command -v node)"
playwright_loader="$(find "$PWD/node_modules" -path '*/playwright-core/lib/server/electron/loader.js' -type f -print -quit)"
if [[ -z "$playwright_loader" || ! -f "$playwright_loader" ]]; then
  echo "Error: Playwright's Electron loader was not found." >&2
  exit 1
fi
mkdir -p "$user_data"
bun build tests/e2e/fixtures/fake-codex.mjs --compile --outfile "$fake_codex"
chmod 700 "$fake_codex"

env -u APPLE_API_KEY -u MONTECARLO_PACKAGED_SMOKE \
  CODEX_PATH="$fake_codex" \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  RUN_DESKTOP_E2E=true \
  PLAYWRIGHT_SKIP_WEBSERVER=true \
  PACKAGED_DESKTOP_EXECUTABLE="$executable" \
  PACKAGED_DESKTOP_PLAYWRIGHT_LOADER="$playwright_loader" \
  PACKAGED_DESKTOP_USER_DATA_DIR="$user_data" \
  PACKAGED_DESKTOP_SMOKE_RESPONSE="Packaged Codex smoke response" \
  "$node_executable" node_modules/@playwright/test/cli.js test tests/e2e/desktop/shell.spec.ts \
    --project electron-desktop \
    --workers 1 \
    --retries 0 \
    --timeout 180000 \
    --grep "packaged app completes and persists a model turn"
