#!/usr/bin/env bash
# Prepares an env file for Playwright CI from .env.example plus optional overrides
# supplied by the current shell environment.

set -euo pipefail

SOURCE_FILE="${1:-.env.example}"
TARGET_FILE="${2:-.env.e2e}"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Error: $SOURCE_FILE not found. Run this from the repo root."
  exit 1
fi

cp "$SOURCE_FILE" "$TARGET_FILE"

ensure_default_var() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$TARGET_FILE"; then
    return
  fi

  printf '%s=%s\n' "$key" "$value" >> "$TARGET_FILE"
}

ensure_default_var "CONVEX_AGENT_MODE" "anonymous"
ensure_default_var "CONVEX_URL" "http://127.0.0.1:3210"
ensure_default_var "CONVEX_SITE_URL" "http://127.0.0.1:3211"
ensure_default_var "VITE_CONVEX_URL" "http://127.0.0.1:3210"
ensure_default_var "VITE_CONVEX_SITE_URL" "http://127.0.0.1:3211"

upsert_var() {
  local key="$1"
  local value="${!key-}"

  if [ -z "$value" ]; then
    return
  fi

  if grep -q "^${key}=" "$TARGET_FILE"; then
    KEY="$key" VALUE="$value" perl -0pi -e 's/^$ENV{KEY}=.*$/$ENV{KEY}=$ENV{VALUE}/mg' "$TARGET_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$TARGET_FILE"
  fi
}

upsert_var "CONVEX_URL"
upsert_var "CONVEX_SITE_URL"
if [ -z "${VITE_CONVEX_URL:-}" ] && [ -n "${CONVEX_URL:-}" ]; then
  VITE_CONVEX_URL="$CONVEX_URL"
fi
if [ -z "${VITE_CONVEX_SITE_URL:-}" ] && [ -n "${CONVEX_SITE_URL:-}" ]; then
  VITE_CONVEX_SITE_URL="$CONVEX_SITE_URL"
fi
upsert_var "VITE_CONVEX_URL"
upsert_var "VITE_CONVEX_SITE_URL"
upsert_var "SITE_URL"
upsert_var "PLAYWRIGHT_WEB_PORT"
upsert_var "PLAYWRIGHT_CONVEX_READY_PORT"

echo "Prepared $TARGET_FILE"
