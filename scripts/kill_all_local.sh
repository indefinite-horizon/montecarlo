#!/usr/bin/env bash
# Kills all local Convex and Vite dev server processes.
# Usage: bash scripts/kill_all_local.sh

set -euo pipefail

killed=0

# Kill Convex dev servers (ports 3210-3219)
for port in $(seq 3210 3219); do
  pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $pids; do
    echo "Killing Convex on port $port (pid $pid)"
    kill "$pid" 2>/dev/null && ((killed++)) || true
  done
done

# Kill Vite dev servers (ports 5173-5182, matching the 10-worktree range)
for port in $(seq 5173 5182); do
  pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $pids; do
    echo "Killing Vite on port $port (pid $pid)"
    kill "$pid" 2>/dev/null && ((killed++)) || true
  done
done

if [ "$killed" -eq 0 ]; then
  echo "No running Convex or Vite dev servers found."
else
  echo "Killed $killed process(es)."
fi
