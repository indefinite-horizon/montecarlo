#!/usr/bin/env bash
# Shared helpers for Convex CLI commands that can report success before exiting.

run_command_until_output() {
  local success_pattern="$1"
  local timeout_seconds="$2"
  local grace_seconds="$3"
  shift 3

  local log_file cmd_pid tail_pid elapsed grace status

  log_file="$(mktemp)"
  "$@" >"$log_file" 2>&1 &
  cmd_pid=$!
  tail -n +1 -f "$log_file" >&2 &
  tail_pid=$!
  elapsed=0

  while kill -0 "$cmd_pid" >/dev/null 2>&1; do
    if grep -Eq "$success_pattern" "$log_file" 2>/dev/null; then
      grace=0
      while [ "$grace" -lt "$grace_seconds" ] && kill -0 "$cmd_pid" >/dev/null 2>&1; do
        sleep 1
        grace=$((grace + 1))
      done
      if kill -0 "$cmd_pid" >/dev/null 2>&1; then
        kill "$cmd_pid" >/dev/null 2>&1 || true
        wait "$cmd_pid" >/dev/null 2>&1 || true
      fi
      kill "$tail_pid" >/dev/null 2>&1 || true
      wait "$tail_pid" >/dev/null 2>&1 || true
      rm -f "$log_file"
      return 0
    fi

    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out waiting for command output matching: $success_pattern" >&2
      kill "$cmd_pid" >/dev/null 2>&1 || true
      wait "$cmd_pid" >/dev/null 2>&1 || true
      kill "$tail_pid" >/dev/null 2>&1 || true
      wait "$tail_pid" >/dev/null 2>&1 || true
      rm -f "$log_file"
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  if wait "$cmd_pid"; then
    status=0
  else
    status=$?
  fi
  if grep -Eq "$success_pattern" "$log_file" 2>/dev/null; then
    status=0
  fi
  kill "$tail_pid" >/dev/null 2>&1 || true
  wait "$tail_pid" >/dev/null 2>&1 || true
  rm -f "$log_file"
  return "$status"
}

run_anonymous_convex_init() {
  local attempt convex_cli

  convex_cli="${CONVEX_CLI:-bunx convex}"
  for attempt in 1 2 3; do
    if run_command_until_output \
      "Configured a local deployment|View the Convex dashboard" \
      "${CONVEX_INIT_TIMEOUT_SECONDS:-90}" \
      5 \
      env CONVEX_AGENT_MODE=anonymous CONVEX_DEPLOYMENT= $convex_cli init; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "Warning: Retrying anonymous Convex init (attempt $((attempt + 1))/3)..."
      sleep 1
    fi
  done

  echo "Error: Failed to initialize anonymous Convex deployment after 3 attempts"
  return 1
}

normalize_anonymous_convex_env_file() {
  local env_file="$1"
  local config_file=".convex/local/default/config.json"
  local deployment_name tmp

  if [ ! -f "$config_file" ]; then
    echo "Error: $config_file not found after Convex init" >&2
    return 1
  fi

  deployment_name=$(sed -n 's/.*"deploymentName":"\([^"]*\)".*/\1/p' "$config_file" | tail -n 1)
  if [ -z "$deployment_name" ]; then
    echo "Error: could not read deploymentName from $config_file" >&2
    return 1
  fi

  tmp=$(mktemp)
  awk '
    /^# Deployment used by `npx convex dev`$/ { next }
    /^CONVEX_DEPLOYMENT=/ { next }
    /^CONVE/ && $0 !~ /^CONVEX_[A-Za-z0-9_]*=/ { next }
    { print }
  ' "$env_file" > "$tmp"
  {
    printf '\n# Deployment used by `npx convex dev`\n'
    printf "CONVEX_DEPLOYMENT=anonymous:%s\n" "$deployment_name"
  } >> "$tmp"
  mv "$tmp" "$env_file"
}

stop_local_convex_backend_for_url() {
  local url="${1:-}"
  local port pids pid wait_attempt

  port="${url##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -z "$pids" ]; then
    return 0
  fi

  for pid in $pids; do
    echo "Stopping leftover anonymous Convex backend on port $port (pid $pid)..." >&2
    kill "$pid" 2>/dev/null || true
  done

  for wait_attempt in $(seq 1 20); do
    pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -z "$pids" ]; then
      return 0
    fi
    sleep 0.25
  done

  echo "Warning: Convex backend on port $port is still running after stop request." >&2
}
