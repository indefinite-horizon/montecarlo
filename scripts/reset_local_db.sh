#!/usr/bin/env bash
# Resets the local Convex DB and re-runs the seed (init).
#
# Usage:
#   bash scripts/reset_local_db.sh          # live reset (dev server can be running)
#   bash scripts/reset_local_db.sh --hard   # delete SQLite file (dev server must be stopped)

set -euo pipefail
cd "$(dirname "$0")/.."

HARD=false
[[ "${1:-}" == "--hard" ]] && HARD=true

if $HARD; then
  # Parse the deployment name from .env.local
  DEPLOYMENT=$(grep '^CONVEX_DEPLOYMENT=' .env.local | cut -d: -f2)
  if [[ -z "$DEPLOYMENT" ]]; then
    echo "Error: could not read CONVEX_DEPLOYMENT from .env.local" >&2
    exit 1
  fi
  # NOTE: Convex-internal path convention — may change across Convex versions
  DB_PATH="$HOME/.convex/anonymous-convex-backend-state/$DEPLOYMENT/convex_local_backend.sqlite3"
  if [[ ! -f "$DB_PATH" ]]; then
    echo "Error: SQLite file not found at $DB_PATH" >&2
    exit 1
  fi
  echo "Deleting $DB_PATH ..."
  rm "$DB_PATH"
  echo "Done. Restart 'bun dev' to reinitialize the DB, then run: bunx convex run --no-push init"
else
  echo "Clearing all Convex data (live reset)..."
  # Create a minimal valid empty zip (no Python dependency)
  printf 'PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' \
    > /tmp/convex_empty.zip
  bunx convex import --replace-all --yes /tmp/convex_empty.zip

  echo "Re-seeding..."
  bunx convex run --no-push init
  echo "Done."
fi
