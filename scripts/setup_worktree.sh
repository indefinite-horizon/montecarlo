#!/usr/bin/env bash
# Sets up a new git worktree with linked local environment files.

set -euo pipefail

MAIN_REPO="$(git worktree list --porcelain | head -1 | sed 's/worktree //')"
WORKTREE_DIR="$(git rev-parse --show-toplevel)"

if [ "$MAIN_REPO" = "$WORKTREE_DIR" ]; then
  bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"
  echo "Already in the main repo, nothing to copy."
  exit 0
fi

ENV_FILE="$MAIN_REPO/.env.local"
EXAMPLE_ENV_FILE="$MAIN_REPO/.env.example"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_ENV_FILE" ]; then
    echo "No .env.local found at $ENV_FILE and no .env.example found at $EXAMPLE_ENV_FILE"
    exit 1
  fi

  cp "$EXAMPLE_ENV_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from $EXAMPLE_ENV_FILE"
fi

cp "$ENV_FILE" "$WORKTREE_DIR/.env.local"
# Remove CONVEX_DEPLOYMENT so the worktree gets its own anonymous backend
# instead of reusing the main repo's deployment.
sed -i '' '/^CONVEX_DEPLOYMENT=/d' "$WORKTREE_DIR/.env.local"
echo "Copied .env.local from $MAIN_REPO to $WORKTREE_DIR (stripped CONVEX_DEPLOYMENT)"

bun i
bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"

echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/setup_local_env.sh"
echo "  2. Set SITE_URL: bunx convex env set SITE_URL http://localhost:<PORT>"
