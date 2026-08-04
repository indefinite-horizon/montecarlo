#!/usr/bin/env bash
# Sets up a new git worktree with linked local environment files.

set -euo pipefail

MAIN_REPO="$(git worktree list --porcelain | head -1 | sed 's/worktree //')"
WORKTREE_DIR="$(git rev-parse --show-toplevel)"

if [ "$MAIN_REPO" = "$WORKTREE_DIR" ]; then
  if [ ! -f "$WORKTREE_DIR/.env.local" ]; then
    cp "$WORKTREE_DIR/.env.example" "$WORKTREE_DIR/.env.local"
    echo "Created .env.local from .env.example"
  fi
  if [ ! -f "$WORKTREE_DIR/.env.runtime.local" ]; then
    cp "$WORKTREE_DIR/.env.example" "$WORKTREE_DIR/.env.runtime.local"
    echo "Created .env.runtime.local from .env.example"
  fi
  bun install --frozen-lockfile
  bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"
  echo "Main checkout setup complete."
  exit 0
fi

ENV_FILE="$MAIN_REPO/.env.local"
EXAMPLE_ENV_FILE="$MAIN_REPO/.env.example"
RUNTIME_ENV_FILE="$MAIN_REPO/.env.runtime.local"
RUNTIME_EXAMPLE_ENV_FILE="$MAIN_REPO/.env.example"

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
SANITIZED_ENV_FILE="$(mktemp)"
trap 'rm -f "$SANITIZED_ENV_FILE"' EXIT
sed '/^CONVEX_DEPLOYMENT=/d' "$WORKTREE_DIR/.env.local" > "$SANITIZED_ENV_FILE"
mv "$SANITIZED_ENV_FILE" "$WORKTREE_DIR/.env.local"
trap - EXIT
echo "Copied .env.local from $MAIN_REPO to $WORKTREE_DIR (stripped CONVEX_DEPLOYMENT)"

if [ ! -f "$RUNTIME_ENV_FILE" ] && [ -f "$RUNTIME_EXAMPLE_ENV_FILE" ]; then
  cp "$RUNTIME_EXAMPLE_ENV_FILE" "$RUNTIME_ENV_FILE"
fi
if [ -f "$RUNTIME_ENV_FILE" ]; then
  cp "$RUNTIME_ENV_FILE" "$WORKTREE_DIR/.env.runtime.local"
  echo "Copied .env.runtime.local from $MAIN_REPO to $WORKTREE_DIR"
fi

bun install --frozen-lockfile
bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"

echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/setup_local_env.sh"
echo "  2. Set SITE_URL: bunx convex env set SITE_URL http://localhost:<PORT>"
