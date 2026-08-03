#!/usr/bin/env bash
# Runs Convex codegen using a temporary anonymous backend.
# Used by CI and the pre-commit hook when no dev server is running.
# Seeds Convex env vars before starting the dev backend.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/convex_cli_utils.sh

ENV_FILE="${1:-.env.example}"
DEV_LOG=$(mktemp)

# Some arm runners intermittently fail Node's fetch to
# version.convex.dev before the anonymous backend can start. Prefer IPv4 for
# Convex CLI DNS lookups while preserving any existing NODE_OPTIONS.
case " ${NODE_OPTIONS:-} " in
  *" --dns-result-order="*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" ;;
esac

cleanup() {
  if [ -n "${DEV_PID:-}" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$DEV_LOG"
}
trap cleanup EXIT

if ! run_anonymous_convex_init; then
  echo "Error: Failed to initialize anonymous Convex deployment." >&2
  exit 1
fi
normalize_anonymous_convex_env_file ".env.local"

if ! bash scripts/setup_local_env.sh --skip-port-check "$ENV_FILE"; then
  echo "Error: Failed to seed Convex env vars." >&2
  exit 1
fi
CODEGEN_CONVEX_URL=$(awk -F= '/^CONVEX_URL=/{print $2; exit}' "$ENV_FILE" 2>/dev/null || true)
stop_local_convex_backend_for_url "${CODEGEN_CONVEX_URL:-${CONVEX_URL:-}}"

# Start anonymous backend in the background and wait for the push to complete.
CONVEX_AGENT_MODE=anonymous bunx convex dev --typecheck disable > "$DEV_LOG" 2>&1 &
DEV_PID=$!

push_wait=0
while [ $push_wait -lt 90 ]; do
  if grep -q "Convex functions ready" "$DEV_LOG" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "Error: Anonymous Convex backend exited before codegen could run." >&2
    cat "$DEV_LOG" >&2
    exit 1
  fi
  sleep 1
  push_wait=$((push_wait + 1))
done
if [ $push_wait -ge 90 ]; then
  echo "Error: Timed out waiting for Convex push to complete." >&2
  cat "$DEV_LOG" >&2
  exit 1
fi

# Generate types from the running backend.
bunx convex codegen --typecheck disable

# cleanup runs via trap
