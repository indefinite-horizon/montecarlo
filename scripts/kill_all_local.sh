#!/usr/bin/env bash
# Stops only the local stack recorded for this checkout.

set -euo pipefail
cd "$(dirname "$0")/.."

PID_FILE=".dev/local-stack.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "No local stack PID file exists for this workspace."
  exit 0
fi

pid="$(tr -dc '0-9' < "$PID_FILE")"
if [[ -z "$pid" ]]; then
  echo "Invalid PID file: $PID_FILE" >&2
  exit 1
fi

command="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
case "$command" in
  *"convex"*"dev"*) ;;
  *)
    echo "PID $pid is not this workspace's Convex dev stack; refusing to stop it." >&2
    exit 1
    ;;
esac

kill "$pid"
rm -- "$PID_FILE"
echo "Stopped local stack for this workspace (pid $pid)."
