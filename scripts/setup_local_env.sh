#!/usr/bin/env bash
# Sets Convex environment variables from an env file.
# Usage: bash scripts/setup_local_env.sh [path-to-env-file]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/convex_cli_utils.sh"

SKIP_PORT_CHECK=false
ENV_FILE=".env.local"
CONVEX_CLI="${CONVEX_CLI:-bunx convex}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-port-check) SKIP_PORT_CHECK=true; shift ;;
    *) ENV_FILE="$1"; shift ;;
  esac
done

# Check that Convex ports 3210-3219 are not all taken (Convex falls back to a
# random OS ephemeral port when all 10 are exhausted, which breaks SITE_URL).
# Skipped when called from run_local.sh, which already found a free port.
if ! $SKIP_PORT_CHECK; then
  all_taken=true
  for port in $(seq 3210 3219); do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -t &>/dev/null; then
      all_taken=false
      break
    fi
  done
  if $all_taken; then
    echo "Error: All Convex dev ports (3210-3219) are in use."
    echo "Run 'bash scripts/kill_all_local.sh' to free them, or manually stop some instances."
    exit 1
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Run this from the repo root."
  exit 1
fi

CONVEX_ENV_FILE=$(mktemp)
cleanup() {
  rm -f "$CONVEX_ENV_FILE"
}
trap cleanup EXIT

# VITE_* variables are client-build inputs, not Convex backend env vars.
awk '!/^(export[[:space:]]+)?VITE_[A-Za-z0-9_]*=/' "$ENV_FILE" > "$CONVEX_ENV_FILE"

env_file_value() {
  local key="$1" value
  value="$(
    awk -v key="$key" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" {
        sub(/^[[:space:]]*(export[[:space:]]+)?[^=]*=/, "")
        value = $0
      }
      END {
        if (value != "") {
          print value
        }
      }
    ' "$CONVEX_ENV_FILE"
  )"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

run_convex_env_set() {
  local deployment_args=()
  if grep -Eq '^(CONVEX_DEPLOY_KEY|CONVEX_DEPLOYMENT|CONVEX_SELF_HOSTED_URL|CONVEX_SELF_HOSTED_ADMIN_KEY)=' "$CONVEX_ENV_FILE"; then
    deployment_args=(--env-file "$CONVEX_ENV_FILE")
  fi

  run_convex_env_set_command() {
    # Plain "${deployment_args[@]}" trips bash + set -u when the array is empty.
    run_command_until_output \
      "Successfully set|already set" \
      90 \
      5 \
      env -i \
      HOME="${HOME:-}" \
      PATH="${PATH:-}" \
      TMPDIR="${TMPDIR:-/tmp}" \
      CONVEX_TMPDIR="${CONVEX_TMPDIR:-}" \
      BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-}" \
      $CONVEX_CLI env set ${deployment_args[@]+"${deployment_args[@]}"} "$@"
  }

  run_convex_env_set_command --from-file "$CONVEX_ENV_FILE" --force || return 1

  # Convex CLI filters this out of --from-file as a CLI-managed var, but local
  # self-hosted runs need the host-mapped value in process env.
  local name value
  for name in CONVEX_URL; do
    value="$(env_file_value "$name")"
    if [ -z "$value" ]; then
      continue
    fi
    run_convex_env_set_command "$name" "$value" || return 1
  done
}

for attempt in 1 2 3; do
  if run_convex_env_set; then
    echo "✔ Successfully synced Convex env vars from $ENV_FILE"
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "⚠ Retrying Convex env sync (attempt $((attempt + 1))/3)..."
    sleep 1
  else
    echo "✖ Failed to sync Convex env vars after 3 attempts"
    exit 1
  fi
done

echo "Done."
