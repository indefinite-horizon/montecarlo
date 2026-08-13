#!/usr/bin/env bash
# Opens the Electron shell against an already-running local Vite renderer.

set -euo pipefail
cd "$(dirname "$0")/.."

renderer_port="${SITE_PORT:-${LOCAL_FRONTEND_PORT:-${CONDUCTOR_PORT:-5173}}}"
case "$renderer_port" in
  ""|*[!0-9]*)
    echo "Error: desktop renderer port must be numeric: $renderer_port" >&2
    exit 1
    ;;
esac
if [ "$renderer_port" -lt 1 ] || [ "$renderer_port" -gt 65535 ]; then
  echo "Error: desktop renderer port must be between 1 and 65535: $renderer_port" >&2
  exit 1
fi

export ELECTRON_START_URL="${ELECTRON_START_URL:-http://localhost:${renderer_port}}"
echo "Opening Electron at $ELECTRON_START_URL..."
bunx wait-on "$ELECTRON_START_URL"
exec bun run --cwd apps/desktop start
