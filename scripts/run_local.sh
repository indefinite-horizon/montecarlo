#!/usr/bin/env bash
# Starts a local anonymous dev environment with explicit Convex cloud/site ports.
#
# This runner configures the anonymous local deployment on the selected ports
# before syncing env vars or pushing code, so Convex one-off commands use the
# same cloud/site ports as the long-running dev stack.

set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/convex_cli_utils.sh

ENV_FILE="${LOCAL_ENV_FILE:-.env.local}"
RUNTIME_ENV_FILE="${LOCAL_RUNTIME_ENV_FILE:-.env.runtime.local}"
AFTER_START_COMMAND="${LOCAL_AFTER_START_COMMAND:-}"
CONVEX_CLI="${CONVEX_CLI:-bunx convex}"
LOCAL_BACKEND_PORT="${LOCAL_BACKEND_PORT:-}"
LOCAL_BACKEND_SITE_PORT="${LOCAL_BACKEND_SITE_PORT:-}"
SITE_PORT="${SITE_PORT:-}"
LOCAL_FRONTEND_PORT="${LOCAL_FRONTEND_PORT:-}"
CONDUCTOR_PORT="${CONDUCTOR_PORT:-}"
LOCAL_FRONTEND_BIND_PORT="${LOCAL_FRONTEND_BIND_PORT:-}"
LOCAL_RUNTIME_PORT="${LOCAL_RUNTIME_PORT:-}"
LOCAL_SUPPRESS_PERIODIC_URL_LOG="${LOCAL_SUPPRESS_PERIODIC_URL_LOG:-}"
ENV_FILE_SET=false
URL_LOG_PID=""
DEV_PID=""

kill_process_tree() {
  local pid="$1" signal="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_process_tree "$child" "$signal"
  done
  kill "-$signal" "$pid" 2>/dev/null || true
}

stop_dev_stack() {
  if [ -n "$DEV_PID" ]; then
    kill_process_tree "$DEV_PID" TERM
    sleep 1
    if kill -0 "$DEV_PID" 2>/dev/null; then
      kill_process_tree "$DEV_PID" KILL
    fi
  fi
  rm -f .dev/local-stack.pid
}

stop_processes_on_port() {
  local port="$1" label="$2" pid pids
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  pids="$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"
  if [ -z "$pids" ]; then
    return
  fi

  echo "Stopping existing $label process on port $port (pid(s): $(echo "$pids" | tr '\n' ' '))..."
  for pid in $pids; do
    kill_process_tree "$pid" TERM
  done
  sleep 1

  pids="$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"
  if [ -z "$pids" ]; then
    return
  fi

  echo "Existing $label process still listening on port $port after TERM; sending KILL (pid(s): $(echo "$pids" | tr '\n' ' '))..."
  for pid in $pids; do
    kill_process_tree "$pid" KILL
  done
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "$URL_LOG_PID" ]; then
    kill "$URL_LOG_PID" 2>/dev/null || true
    wait "$URL_LOG_PID" 2>/dev/null || true
  fi
  stop_dev_stack
  exit "$status"
}
trap cleanup EXIT INT TERM

usage() {
  cat <<'EOF'
Usage: bash scripts/run_local.sh [env-file] [--command "<command>"]

Starts a local anonymous Convex + Vite stack. Without --command, the stack
stays attached until Ctrl+C. With --command, the command runs after both
services are healthy, then the stack is stopped.

Arguments:
  env-file              Env file to update and sync. Default: .env.local.
  --command "<command>" Command to run after the anonymous stack is healthy.
  -h, --help            Show this help.

Environment:
  LOCAL_ENV_FILE              Env file when no env-file argument is given.
  LOCAL_AFTER_START_COMMAND   Default command when --command is not supplied.
  LOCAL_BACKEND_PORT          Explicit Convex cloud port.
  LOCAL_BACKEND_SITE_PORT     Explicit Convex site port. Defaults to cloud+1.
  SITE_PORT                   Public frontend port. Takes precedence over
                              LOCAL_FRONTEND_PORT and CONDUCTOR_PORT.
  LOCAL_FRONTEND_PORT         Frontend port to try before probing upward.
  CONDUCTOR_PORT              Frontend port supplied by Conductor.
  LOCAL_FRONTEND_BIND_PORT    Vite bind port. Defaults to selected frontend port.
  CONVEX_CLI                  Convex CLI command. Default: bunx convex.
  LOCAL_RUNTIME_ENV_FILE      Runtime env file. Default: .env.runtime.local.
  LOCAL_RUNTIME_PORT          Explicit loopback companion port.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --command)
      if [[ $# -lt 2 ]]; then
        echo "Error: --command requires a shell command." >&2
        exit 1
      fi
      if [[ -z "$2" ]]; then
        echo "Error: --command value cannot be empty." >&2
        exit 1
      fi
      AFTER_START_COMMAND="$2"
      shift 2
      ;;
    *)
      if $ENV_FILE_SET; then
        echo "Error: unexpected extra argument: $1" >&2
        exit 1
      fi
      ENV_FILE="$1"
      ENV_FILE_SET=true
      shift
      ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found."
  exit 1
fi

if [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "Error: $RUNTIME_ENV_FILE not found. Copy .env.runtime.example first."
  exit 1
fi

port_in_use() {
  lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

MAX_PORT_ATTEMPTS=100

find_free_port() {
  local port=$1 inc=$2 label=$3 attempts=0
  while port_in_use "$port"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$MAX_PORT_ATTEMPTS" ]; then
      echo "Error: could not find a free $label port after $MAX_PORT_ATTEMPTS attempts." >&2
      exit 1
    fi
    echo "Port $port is in use, trying $((port + inc))..." >&2
    port=$((port + inc))
  done
  echo "$port"
}

find_free_port_pair() {
  local port=$1 inc=$2 label=$3 attempts=0
  while port_in_use "$port" || port_in_use "$((port + 1))"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$MAX_PORT_ATTEMPTS" ]; then
      echo "Error: could not find a free $label port pair after $MAX_PORT_ATTEMPTS attempts." >&2
      exit 1
    fi
    echo "Port pair $port/$((port + 1)) is in use, trying $((port + inc))/$((port + inc + 1))..." >&2
    port=$((port + inc))
  done
  echo "$port"
}

require_free_port() {
  local port="$1" label="$2"
  if port_in_use "$port"; then
    echo "Error: $label port $port is already in use." >&2
    exit 1
  fi
}

upsert_env_var() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" { next }
    { print }
  ' "$ENV_FILE" > "$tmp"
  if [ -s "$tmp" ] && [ "$(tail -c 1 "$tmp")" != "" ]; then
    printf '\n' >> "$tmp"
  fi
  {
    cat "$tmp"
    printf '%s=%s\n' "$key" "$value"
  } > "$ENV_FILE"
  rm -f "$tmp"
}

env_file_value() {
  local key="$1" file="${2:-$ENV_FILE}" value
  value="$(
    awk -v key="$key" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
        sub(/^[[:space:]]*(export[[:space:]]+)?[^=]*=/, "")
        value = $0
      }
      END {
        if (value != "") {
          print value
        }
      }
    ' "$file"
  )"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

LOCAL_DEPLOYMENT_CONFIG_FILE=".convex/local/default/config.json"
LOCAL_DEPLOYMENT_DB_FILE=".convex/local/default/convex_local_backend.sqlite3"

env_file_has_usable_deployment_selector() {
  local deployment_value
  deployment_value="$(env_file_value "CONVEX_DEPLOYMENT")"

  if [ -n "$(env_file_value "CONVEX_DEPLOY_KEY")" ]; then
    return 0
  fi

  if [ -n "$(env_file_value "CONVEX_SELF_HOSTED_URL")" ] &&
    [ -n "$(env_file_value "CONVEX_SELF_HOSTED_ADMIN_KEY")" ]; then
    return 0
  fi

  case "$deployment_value" in
    anonymous:*)
      if [ -f "$LOCAL_DEPLOYMENT_CONFIG_FILE" ]; then
        return 0
      fi
      echo "Ignoring stale anonymous Convex deployment selector from $ENV_FILE because $LOCAL_DEPLOYMENT_CONFIG_FILE is missing."
      return 1
      ;;
    "")
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

stop_or_reject_existing_local_backend_for_workspace() {
  local db_path handled_pids pid ppid attempt port command
  if [ ! -f "$LOCAL_DEPLOYMENT_DB_FILE" ]; then
    return 0
  fi

  db_path="$PWD/$LOCAL_DEPLOYMENT_DB_FILE"
  handled_pids=""
  for pid in $(
    {
      lsof -t "$db_path" 2>/dev/null || true
      for port in $(seq 3210 3219); do
        lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true
      done
    } | sort -u
  ); do
    case " $handled_pids " in
      *" $pid "*) continue ;;
    esac
    handled_pids="$handled_pids $pid"

    command="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
    case "$command" in
      *"$db_path"*) ;;
      *) continue ;;
    esac

    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$ppid" ]; then
      continue
    fi

    if [ "$ppid" != "1" ]; then
      echo "Error: a local Convex backend for this workspace is already running (pid $pid)." >&2
      echo "Stop the existing stack before starting another one." >&2
      return 1
    fi

    echo "Stopping orphaned local Convex backend for this workspace (pid $pid)."
    kill "$pid" 2>/dev/null || true
    for attempt in $(seq 1 20); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

sync_local_deployment_config_ports() {
  local deployment_value deployment_name config_file
  deployment_value="$(env_file_value "CONVEX_DEPLOYMENT")"
  case "$deployment_value" in
    anonymous:*) deployment_name="${deployment_value#anonymous:}" ;;
    *) return 0 ;;
  esac

  config_file="$LOCAL_DEPLOYMENT_CONFIG_FILE"
  if [ ! -f "$config_file" ]; then
    echo "Error: $config_file not found for $deployment_value. Run Convex init first." >&2
    return 1
  fi

  CONFIG_FILE="$config_file" \
    EXPECTED_DEPLOYMENT="$deployment_name" \
    CLOUD_PORT="$backend_port" \
    SITE_PROXY_PORT="$backend_site_port" \
    bun -e '
const fs = require("fs");

const configFile = process.env.CONFIG_FILE;
const expectedDeployment = process.env.EXPECTED_DEPLOYMENT;
const cloudPort = Number(process.env.CLOUD_PORT);
const sitePort = Number(process.env.SITE_PROXY_PORT);
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));

if (config.deploymentName && config.deploymentName !== expectedDeployment) {
  console.error(
    `Error: ${configFile} is for ${config.deploymentName}, expected ${expectedDeployment}.`,
  );
  process.exit(1);
}

config.deploymentName = expectedDeployment;
config.ports = { ...(config.ports ?? {}), cloud: cloudPort, site: sitePort };
fs.writeFileSync(configFile, JSON.stringify(config));
'
  echo "Updated $config_file to use Convex ports $backend_port/$backend_site_port."
}

write_selected_ports_to_env() {
  upsert_env_var "CONVEX_AGENT_MODE" "anonymous"
  upsert_env_var "CONVEX_URL" "http://127.0.0.1:${backend_port}"
  upsert_env_var "VITE_CONVEX_URL" "http://127.0.0.1:${backend_port}"
  upsert_env_var "CONVEX_SITE_URL" "http://127.0.0.1:${backend_site_port}"
  upsert_env_var "VITE_CONVEX_SITE_URL" "http://127.0.0.1:${backend_site_port}"
  upsert_env_var "SITE_URL" "http://localhost:${site_port}"
}

sync_convex_env_from_file() {
  local convex_env_file convex_url status
  convex_env_file=$(mktemp)

  # VITE_* variables are client-build inputs, not Convex backend env vars.
  awk '!/^(export[[:space:]]+)?VITE_[A-Za-z0-9_]*=/' "$ENV_FILE" > "$convex_env_file"

  echo "Syncing Convex env vars from $ENV_FILE..."
  set +e
  $CONVEX_CLI env set --env-file "$ENV_FILE" --from-file "$convex_env_file" --force
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    rm -f "$convex_env_file"
    return "$status"
  fi

  # The CLI filters CONVEX_URL out of --from-file as a managed URL, but local
  # functions in this repo still read it from backend env.
  convex_url="$(env_file_value "CONVEX_URL" "$convex_env_file")"
  if [ -n "$convex_url" ]; then
    set +e
    $CONVEX_CLI env set --env-file "$ENV_FILE" CONVEX_URL "$convex_url"
    status=$?
    set -e
    if [ "$status" -ne 0 ]; then
      rm -f "$convex_env_file"
      return "$status"
    fi
  fi

  rm -f "$convex_env_file"
}

wait_for_url() {
  local url="$1" label="$2" timeout_seconds=300 elapsed=0
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timeout waiting for ${label} at ${url}" >&2
  return 1
}

wait_for_convex_ports_free() {
  local label="$1" attempt
  for attempt in $(seq 1 60); do
    if ! port_in_use "$backend_port" && ! port_in_use "$backend_site_port"; then
      return 0
    fi
    if [ "$attempt" -eq 1 ]; then
      echo "Waiting for Convex one-off backend to release ports $backend_port/$backend_site_port after $label..."
    fi
    sleep 0.5
  done

  echo "Error: Convex ports $backend_port/$backend_site_port are still in use after $label." >&2
  return 1
}

print_urls() {
  echo "Using local anonymous stack:"
  echo "  Web:         http://localhost:${site_port}"
  echo "  Convex:      http://127.0.0.1:${backend_port}"
  echo "  Convex site: http://127.0.0.1:${backend_site_port}"
  echo "  Runtime:     http://127.0.0.1:${runtime_port}"
}

start_periodic_url_log() {
  if [ -n "$LOCAL_SUPPRESS_PERIODIC_URL_LOG" ]; then
    return
  fi

  (
    while true; do
      sleep 30
      print_urls
    done
  ) &
  URL_LOG_PID=$!
}

stop_or_reject_existing_local_backend_for_workspace

FRONTEND_PORT_SOURCE="default"
if [ -n "$SITE_PORT" ]; then
  LOCAL_FRONTEND_PORT="$SITE_PORT"
  FRONTEND_PORT_SOURCE="site"
elif [ -n "$LOCAL_FRONTEND_PORT" ]; then
  FRONTEND_PORT_SOURCE="local"
elif [ -n "$CONDUCTOR_PORT" ]; then
  LOCAL_FRONTEND_PORT="$CONDUCTOR_PORT"
  FRONTEND_PORT_SOURCE="conductor"
fi

if [ -n "$LOCAL_BACKEND_PORT" ]; then
  backend_port="$LOCAL_BACKEND_PORT"
  backend_site_port="${LOCAL_BACKEND_SITE_PORT:-$((backend_port + 1))}"
  require_free_port "$backend_port" "Convex cloud"
  require_free_port "$backend_site_port" "Convex site"
else
  backend_port=$(find_free_port_pair 3210 2 "Convex backend")
  backend_site_port=$((backend_port + 1))
fi

frontend_start_port="${LOCAL_FRONTEND_PORT:-5173}"
if [ "$FRONTEND_PORT_SOURCE" = "conductor" ]; then
  if [ "$frontend_start_port" -eq "$backend_port" ] || [ "$frontend_start_port" -eq "$backend_site_port" ]; then
    echo "Error: CONDUCTOR_PORT $frontend_start_port is reserved for Convex." >&2
    exit 1
  fi
  frontend_port="$frontend_start_port"
else
  frontend_port=$(find_free_port "$frontend_start_port" 1 "frontend")
  while [ "$frontend_port" -eq "$backend_port" ] || [ "$frontend_port" -eq "$backend_site_port" ]; do
    echo "Port $frontend_port is already reserved for Convex, trying $((frontend_port + 1))..." >&2
    frontend_port=$(find_free_port "$((frontend_port + 1))" 1 "frontend")
  done
fi

frontend_bind_port="${LOCAL_FRONTEND_BIND_PORT:-$frontend_port}"
site_port="$frontend_port"
if [ "$frontend_bind_port" -eq "$backend_port" ] || [ "$frontend_bind_port" -eq "$backend_site_port" ]; then
  echo "Error: frontend bind port $frontend_bind_port is reserved for Convex." >&2
  exit 1
fi
require_free_port "$frontend_bind_port" "frontend bind"

if [ -n "$LOCAL_RUNTIME_PORT" ]; then
  runtime_port="$LOCAL_RUNTIME_PORT"
elif [ -n "$CONDUCTOR_PORT" ]; then
  runtime_port="$((CONDUCTOR_PORT + 3))"
else
  runtime_port="$(find_free_port 4242 1 "runtime")"
fi

while [ "$runtime_port" -eq "$backend_port" ] ||
  [ "$runtime_port" -eq "$backend_site_port" ] ||
  [ "$runtime_port" -eq "$frontend_bind_port" ]; do
  runtime_port="$(find_free_port "$((runtime_port + 1))" 1 "runtime")"
done
require_free_port "$runtime_port" "runtime"

write_selected_ports_to_env

print_urls
echo "Updated $ENV_FILE with selected local URLs."

export CONVEX_AGENT_MODE=anonymous
export LOCAL_FRONTEND_PORT="$frontend_port"
export LOCAL_FRONTEND_BIND_PORT="$frontend_bind_port"
export SITE_PORT="$site_port"
export MONTE_CARLO_RUNTIME_DEV=1
export MONTE_CARLO_RUNTIME_PORT="$runtime_port"
export MONTE_CARLO_RUNTIME_ALLOWED_ORIGINS="http://localhost:${site_port},http://127.0.0.1:${frontend_bind_port}"
export VITE_RUNTIME_URL="http://127.0.0.1:${runtime_port}"
export VITE_RUNTIME_TOKEN="$(env_file_value "MONTE_CARLO_RUNTIME_TOKEN" "$RUNTIME_ENV_FILE")"

if env_file_has_usable_deployment_selector; then
  echo "Using existing Convex deployment selector from $ENV_FILE."
else
  echo "Initializing anonymous Convex deployment..."
  run_anonymous_convex_init
  normalize_anonymous_convex_env_file "$ENV_FILE"
  write_selected_ports_to_env
fi

sync_local_deployment_config_ports
write_selected_ports_to_env

sync_convex_env_from_file
wait_for_convex_ports_free "env sync"
write_selected_ports_to_env

echo "Pushing Convex code once..."
CONVEX_AGENT_MODE=anonymous \
  $CONVEX_CLI dev \
    --env-file "$ENV_FILE" \
    --typecheck enable \
    --local \
    --local-cloud-port "$backend_port" \
    --local-site-port "$backend_site_port" \
    --once

wait_for_convex_ports_free "push"
write_selected_ports_to_env

echo "Seeding local Convex data..."
CONVEX_AGENT_MODE=anonymous \
  $CONVEX_CLI run --env-file "$ENV_FILE" init

wait_for_convex_ports_free "seed"
write_selected_ports_to_env

DEV_GIT_REF="${VITE_DEV_GIT_BRANCH:-$(git branch --show-current 2>/dev/null || true)}"
if [ -z "$DEV_GIT_REF" ]; then
  DEV_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || true)"
fi
WEB_DEV_COMMAND="bun --env-file=\"$ENV_FILE\" run dev:web -- --host 0.0.0.0 --port $frontend_bind_port --strictPort"
RUNTIME_DEV_COMMAND="bun --env-file=\"$RUNTIME_ENV_FILE\" run --filter './apps/runtime' dev"
APP_DEV_COMMAND="bunx concurrently --kill-others-on-fail -n web,runtime '$WEB_DEV_COMMAND' '$RUNTIME_DEV_COMMAND'"

echo "Starting dev stack..."
start_periodic_url_log
VITE_DEV_GIT_BRANCH="$DEV_GIT_REF" \
  $CONVEX_CLI dev \
    --env-file "$ENV_FILE" \
    --typecheck enable \
    --local \
    --local-cloud-port "$backend_port" \
    --local-site-port "$backend_site_port" \
    --tail-logs pause-on-deploy \
    --start "$APP_DEV_COMMAND" &
DEV_PID=$!
mkdir -p .dev
printf '%s\n' "$DEV_PID" > .dev/local-stack.pid

if [ -n "$AFTER_START_COMMAND" ]; then
  wait_for_url "http://127.0.0.1:${backend_site_port}/api/health/ready" "Convex site"
  wait_for_url "http://localhost:${site_port}" "web app"

  echo "Services ready, running command..."
  set +e
  LOCAL_ENV_FILE="$ENV_FILE" bash -c "$AFTER_START_COMMAND"
  command_status=$?
  set -e
  stop_dev_stack
  exit "$command_status"
fi

set +e
wait "$DEV_PID"
dev_status=$?
set -e
exit "$dev_status"
