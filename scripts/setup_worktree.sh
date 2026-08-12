#!/usr/bin/env bash
# Sets up a new git worktree with its local environment file.

set -euo pipefail

WORKTREE_DIR="$(git rev-parse --show-toplevel)"

if [ "${CONDUCTOR_IS_LOCAL:-1}" = "0" ]; then
  bun install --frozen-lockfile
  bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"
  echo "Cloud workspace setup complete."
  exit 0
fi

MAIN_REPO="${CONDUCTOR_ROOT_PATH:-$(git worktree list --porcelain | head -1 | sed 's/worktree //')}"

if [ "$MAIN_REPO" = "$WORKTREE_DIR" ]; then
  if [ ! -f "$WORKTREE_DIR/.env.local" ]; then
    cp "$WORKTREE_DIR/.env.example" "$WORKTREE_DIR/.env.local"
    echo "Created .env.local from .env.example"
  fi
  bun install --frozen-lockfile
  bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"
  echo "Main checkout setup complete."
  exit 0
fi

ENV_FILE="$MAIN_REPO/.env.local"

# Conductor copies matching environment files into the new workspace before it
# runs setup. Prefer those copies so setup does not depend on the main checkout
# being available at CONDUCTOR_ROOT_PATH (for example, in remote workspace
# mirrors). Fall back to the main checkout for older Conductor configurations.
if [ -f "$WORKTREE_DIR/.env.local" ]; then
  echo "Using .env.local copied into $WORKTREE_DIR"
elif [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$WORKTREE_DIR/.env.local"
  echo "Copied .env.local from $MAIN_REPO to $WORKTREE_DIR"
elif [ -f "$WORKTREE_DIR/.env.example" ]; then
  cp "$WORKTREE_DIR/.env.example" "$WORKTREE_DIR/.env.local"
  echo "Created .env.local from .env.example"
else
  echo "No .env.local or .env.example available for workspace setup" >&2
  exit 1
fi

# Remove CONVEX_DEPLOYMENT so the worktree gets its own anonymous backend
# instead of reusing the main repo's deployment.
SANITIZED_ENV_FILE="$(mktemp)"
trap 'rm -f "$SANITIZED_ENV_FILE"' EXIT
sed '/^CONVEX_DEPLOYMENT=/d' "$WORKTREE_DIR/.env.local" > "$SANITIZED_ENV_FILE"
mv "$SANITIZED_ENV_FILE" "$WORKTREE_DIR/.env.local"
trap - EXIT
echo "Prepared $WORKTREE_DIR/.env.local (stripped CONVEX_DEPLOYMENT)"

bun install --frozen-lockfile
bash "$WORKTREE_DIR/scripts/setup_git_hooks.sh"

echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/setup_local_env.sh"
echo "  2. Set SITE_URL: bunx convex env set SITE_URL http://localhost:<PORT>"
