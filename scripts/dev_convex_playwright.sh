#!/usr/bin/env bash
# Starts a local Convex dev server for Playwright and syncs backend env vars
# once the deployment is ready.

set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/convex_cli_utils.sh

ENV_FILE="${1:-.env.local}"
LOG_FILE=".context/playwright-convex.log"
READY_FILE=".context/playwright-convex-ready"
CONVEX_CLI="${CONVEX_CLI:-bunx convex}"
LOCAL_CONVEX_DEV_COMMAND="${LOCAL_CONVEX_DEV_COMMAND:-}"
LOCAL_CONVEX_PREPARE_BEFORE_DEV="${LOCAL_CONVEX_PREPARE_BEFORE_DEV:-}"
PLAYWRIGHT_CONVEX_READY_PORT="${PLAYWRIGHT_CONVEX_READY_PORT:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Run this from the repo root."
  exit 1
fi

mkdir -p .context
rm -f "$READY_FILE"
rm -f "$LOG_FILE"

READY_PID=""
CONVEX_PID=""
start_playwright_ready_server() {
  if [ -z "$PLAYWRIGHT_CONVEX_READY_PORT" ]; then
    return
  fi

  READY_FILE="$READY_FILE" READY_PORT="$PLAYWRIGHT_CONVEX_READY_PORT" bun -e '
const file = process.env.READY_FILE;
const port = Number(process.env.READY_PORT);

if (!file || !Number.isInteger(port) || port <= 0) {
  throw new Error("Invalid Playwright Convex readiness server configuration");
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/ready") {
      return new Response("not found\n", { status: 404 });
    }

    const ready = await Bun.file(file).exists();
    return new Response(ready ? "ready\n" : "not ready\n", { status: ready ? 200 : 503 });
  },
});

await new Promise(() => {});
' &
  READY_PID=$!

  sleep 0.2
  if ! kill -0 "$READY_PID" >/dev/null 2>&1; then
    wait "$READY_PID"
    exit 1
  fi
}

mark_playwright_ready() {
  if [ -n "$PLAYWRIGHT_CONVEX_READY_PORT" ]; then
    touch "$READY_FILE"
    start_playwright_ready_server
  fi
}

cleanup() {
  rm -f "$READY_FILE"
  if [ -n "$READY_PID" ]; then
    kill "$READY_PID" >/dev/null 2>&1 || true
    wait "$READY_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$CONVEX_PID" ] && kill -0 "$CONVEX_PID" >/dev/null 2>&1; then
    kill "$CONVEX_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

upsert_env_var() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
      if (!written) {
        print key "=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

sync_anonymous_convex_urls_from_config() {
  local config_file=".convex/local/default/config.json"
  local ports cloud_port site_port

  if [ ! -f "$config_file" ]; then
    return 0
  fi

  if ! ports=$(
    CONFIG_FILE="$config_file" bun -e '
const fs = require("fs");

const config = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, "utf8"));
const cloudPort = Number(config.ports?.cloud);
const sitePort = Number(config.ports?.site);

if (!Number.isInteger(cloudPort) || cloudPort <= 0 || !Number.isInteger(sitePort) || sitePort <= 0) {
  process.exit(1);
}

console.log(`${cloudPort} ${sitePort}`);
'
  ); then
    echo "Error: failed to parse Convex ports from $config_file." >&2
    return 1
  fi

  read -r cloud_port site_port <<< "$ports"
  upsert_env_var "CONVEX_URL" "http://127.0.0.1:${cloud_port}"
  upsert_env_var "CONVEX_SITE_URL" "http://127.0.0.1:${site_port}"
  upsert_env_var "VITE_CONVEX_URL" "http://127.0.0.1:${cloud_port}"
  upsert_env_var "VITE_CONVEX_SITE_URL" "http://127.0.0.1:${site_port}"
  echo "Using anonymous Convex ports $cloud_port/$site_port from $config_file." >&2
}

set -a
. "$ENV_FILE"
set +a

if [ "${CONVEX_AGENT_MODE:-}" = "anonymous" ] && { [ -z "$LOCAL_CONVEX_DEV_COMMAND" ] || [ -n "$LOCAL_CONVEX_PREPARE_BEFORE_DEV" ]; }; then
  echo "Preparing anonymous Convex deployment before starting dev server..."
  run_anonymous_convex_init
  normalize_anonymous_convex_env_file "$ENV_FILE"
  sync_anonymous_convex_urls_from_config
  set -a
  . "$ENV_FILE"
  set +a
  bash scripts/setup_local_env.sh "$ENV_FILE"
  stop_local_convex_backend_for_url "${CONVEX_URL:-}"
fi

add_ready_candidate() {
  local base_url="${1:-}"
  if [ -z "$base_url" ]; then
    return
  fi
  READY_CANDIDATES+=("${base_url%/}/api/health/ready")
}

add_backend_plus_one_candidate() {
  local url="${1:-}"
  local port="${url##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    return
  fi
  READY_CANDIDATES+=("http://127.0.0.1:$((port + 1))/api/health/ready")
}

if [ -n "$LOCAL_CONVEX_DEV_COMMAND" ]; then
  $LOCAL_CONVEX_DEV_COMMAND 2>&1 | tee "$LOG_FILE" >&2 &
else
  $CONVEX_CLI dev 2>&1 | tee "$LOG_FILE" >&2 &
fi
CONVEX_PID=$!

timeout_seconds=300
elapsed=0

until grep -qE "Configured a local deployment|Started running a deployment locally|Convex functions ready" "$LOG_FILE" 2>/dev/null; do
  if ! kill -0 "$CONVEX_PID" >/dev/null 2>&1; then
    wait "$CONVEX_PID"
    exit 1
  fi

  if [ "$elapsed" -ge "$timeout_seconds" ]; then
    echo "Timed out waiting for Convex to start."
    exit 1
  fi

  sleep 1
  elapsed=$((elapsed + 1))
done

READY_CANDIDATES=()
add_ready_candidate "${CONVEX_SITE_URL:-}"
add_backend_plus_one_candidate "${CONVEX_URL:-}"

logged_urls="$(grep -o 'http://127\.0\.0\.1:[0-9]\+' "$LOG_FILE" || true)"
while IFS= read -r logged_url; do
  [ -z "$logged_url" ] && continue
  add_ready_candidate "$logged_url"
  add_backend_plus_one_candidate "$logged_url"
done <<< "$logged_urls"

if [ "${#READY_CANDIDATES[@]}" -eq 0 ]; then
  echo "Failed to determine the local Convex readiness URL from $LOG_FILE."
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

bash scripts/setup_local_env.sh "$ENV_FILE"
echo "Convex env sync complete." >&2

elapsed=0
until grep -q "Convex functions ready" "$LOG_FILE" 2>/dev/null; do
  if ! kill -0 "$CONVEX_PID" >/dev/null 2>&1; then
    wait "$CONVEX_PID"
    exit 1
  fi

  if [ "$elapsed" -ge "$timeout_seconds" ]; then
    echo "Timed out waiting for Convex functions ready."
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  sleep 1
  elapsed=$((elapsed + 1))
done

elapsed=0
READY_URL=""
until [ -n "$READY_URL" ]; do
  for candidate in "${READY_CANDIDATES[@]}"; do
    if curl --silent --show-error --fail "$candidate" >/dev/null; then
      READY_URL="$candidate"
      break
    fi
  done

  if [ -n "$READY_URL" ]; then
    break
  fi

  if ! kill -0 "$CONVEX_PID" >/dev/null 2>&1; then
    wait "$CONVEX_PID"
    exit 1
  fi

  if [ "$elapsed" -ge "$timeout_seconds" ]; then
    echo "Timed out waiting for Convex readiness."
    printf 'Candidate URLs:\n'
    printf '  %s\n' "${READY_CANDIDATES[@]}"
    echo "Recent Convex log output:"
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  sleep 1
  elapsed=$((elapsed + 1))
done

echo "Seeding init..." >&2
$CONVEX_CLI run --env-file "$ENV_FILE" init 2>&1
echo "Convex seed init complete." >&2

mark_playwright_ready

wait "$CONVEX_PID"
