#!/usr/bin/env bash
# Uploads only Vercel-owned variables for production or preview deployments.
set -euo pipefail

usage() {
  printf 'Usage: bash scripts/set_vercel_deploy_env.sh <prod|preview> [env-file]\n'
}

deployment_environment="${1:-}"
if [[ "$deployment_environment" != prod && "$deployment_environment" != preview ]]; then
  usage >&2
  exit 1
fi
env_file="${2:-.env.$deployment_environment}"
if [[ ! -f "$env_file" ]]; then
  printf 'Environment file not found: %s\n' "$env_file" >&2
  exit 1
fi

if [[ ! -f .vercel/project.json && ( -z "${VERCEL_PROJECT_ID:-}" || -z "${VERCEL_ORG_ID:-}" ) ]]; then
  printf 'This checkout is not linked to Vercel. Run: bunx vercel link\n' >&2
  exit 1
fi

if command -v bunx >/dev/null 2>&1; then
  vercel_cli=(bunx vercel)
else
  vercel_cli=(npx --yes vercel)
fi

read_env_value() {
  local requested_name="$1"
  local line name
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    if [[ "$name" == "$requested_name" ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <"$env_file"
  return 1
}

vercel_names=(
  CONVEX_DEPLOY_KEY
  VITE_POSTHOG_HOST
  VITE_AUTH_REQUIRED
  VITE_AUTH_GOOGLE_ENABLED
  VITE_ANALYTICS_DISABLED
  VITE_DEMO_MODE
)
vercel_target="$deployment_environment"
if [[ "$deployment_environment" == prod ]]; then
  vercel_names+=(VITE_CONVEX_URL VITE_CONVEX_SITE_URL)
  vercel_target="production"
fi

posthog_project_token="$(read_env_value VITE_POSTHOG_PROJECT_TOKEN || true)"
if [[ "$deployment_environment" == prod && -z "$posthog_project_token" ]]; then
  printf 'Required Vercel production variable is missing or empty: VITE_POSTHOG_PROJECT_TOKEN\n' >&2
  exit 1
fi

for name in "${vercel_names[@]}"; do
  if ! value="$(read_env_value "$name")" || [[ -z "$value" ]]; then
    printf 'Required Vercel %s variable is missing or empty: %s\n' \
      "$deployment_environment" "$name" >&2
    exit 1
  fi
  if [[ "$name" == "CONVEX_DEPLOY_KEY" ]]; then
    printf '%s' "$value" | \
      "${vercel_cli[@]}" env add "$name" "$vercel_target" --force --sensitive
  else
    printf '%s' "$value" | \
      "${vercel_cli[@]}" env add "$name" "$vercel_target" --force
  fi
done

if [[ -n "$posthog_project_token" ]]; then
  printf '%s' "$posthog_project_token" | \
    "${vercel_cli[@]}" env add VITE_POSTHOG_PROJECT_TOKEN "$vercel_target" --force
else
  printf 'Skipping optional Vercel preview variable: VITE_POSTHOG_PROJECT_TOKEN\n'
fi

printf 'Configured Vercel %s variables from %s\n' "$vercel_target" "$env_file"
if [[ "$deployment_environment" == prod ]]; then
  printf 'Create a production deployment with: bunx vercel deploy --prod --logs\n'
else
  printf 'Create a preview deployment with: bunx vercel deploy --logs\n'
fi
