#!/usr/bin/env bash
# Installs repository Git hooks from tracked scripts.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
HOOK_SOURCE="$ROOT/scripts/pre-commit"
HOOK_DIR="$(git rev-parse --git-common-dir)/hooks"
HOOK_TARGET="$HOOK_DIR/pre-commit"

if [ ! -f "$HOOK_SOURCE" ]; then
  echo "Missing hook source: $HOOK_SOURCE" >&2
  exit 1
fi

mkdir -p "$HOOK_DIR"
chmod +x "$HOOK_SOURCE"
ln -sfn "$HOOK_SOURCE" "$HOOK_TARGET"

# Prefer the explicit .git/hooks symlink so worktrees and normal checkouts use
# the same tracked hook source without relying on repo-local config.
git config --unset core.hooksPath 2>/dev/null || true

echo "Linked $HOOK_TARGET -> $HOOK_SOURCE"
