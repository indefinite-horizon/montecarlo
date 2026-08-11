#!/usr/bin/env bash
# Uploads only Convex-owned variables for production or preview deployments.
set -euo pipefail

usage() {
  printf 'Usage: bash scripts/set_convex_deploy_env.sh <prod|preview> [env-file]\n'
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

if command -v bunx >/dev/null 2>&1; then
  convex_cli=(bunx convex)
else
  convex_cli=(npx --yes convex)
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

default_names=(
  SITE_URL
  BETTER_AUTH_SECRET
  RESEND_API_KEY
  RESEND_FROM_EMAIL
  POSTHOG_HOST
  MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY
  APP_RELEASE_CHANNEL
  ANALYTICS_DISABLED
)
temporary_defaults_file="$(mktemp)"
temporary_deployment_file="$(mktemp)"
cleanup() {
  rm -f "$temporary_defaults_file" "$temporary_deployment_file"
}
trap cleanup EXIT
chmod 600 "$temporary_defaults_file" "$temporary_deployment_file"

for name in "${default_names[@]}"; do
  if ! value="$(read_env_value "$name")" || [[ -z "$value" ]]; then
    printf 'Required Convex %s default is missing or empty: %s\n' \
      "$deployment_environment" "$name" >&2
    exit 1
  fi
  printf '%s=%s\n' "$name" "$value" >>"$temporary_defaults_file"
done

posthog_project_token="$(read_env_value POSTHOG_PROJECT_TOKEN || true)"
if [[ "$deployment_environment" == prod && -z "$posthog_project_token" ]]; then
  printf 'Required Convex production default is missing or empty: POSTHOG_PROJECT_TOKEN\n' >&2
  exit 1
fi
printf 'POSTHOG_PROJECT_TOKEN=%s\n' "$posthog_project_token" >>"$temporary_defaults_file"

if [[ "$deployment_environment" == prod ]]; then
  for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    value="$(read_env_value "$name" || true)"
    printf '%s=%s\n' "$name" "$value" >>"$temporary_defaults_file"
  done
fi

"${convex_cli[@]}" env default set \
  --type "$deployment_environment" \
  --from-file "$temporary_defaults_file" \
  --force
printf 'Configured Convex project defaults for future %s deployments.\n' "$deployment_environment"

if [[ "$deployment_environment" == prod ]]; then
  deployment_names=(CONVEX_URL CONVEX_SITE_URL)
  for name in "${default_names[@]}" "${deployment_names[@]}"; do
    if ! value="$(read_env_value "$name")" || [[ -z "$value" ]]; then
      printf 'Required Convex production variable is missing or empty: %s\n' "$name" >&2
      exit 1
    fi
    printf '%s=%s\n' "$name" "$value" >>"$temporary_deployment_file"
  done
  printf 'POSTHOG_PROJECT_TOKEN=%s\n' "$posthog_project_token" >>"$temporary_deployment_file"
  for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    value="$(read_env_value "$name" || true)"
    printf '%s=%s\n' "$name" "$value" >>"$temporary_deployment_file"
  done
  "${convex_cli[@]}" env set --prod --from-file "$temporary_deployment_file" --force
  printf 'Configured the current Convex production deployment from %s\n' "$env_file"
  printf 'CONVEX_URL and CONVEX_SITE_URL were applied only to the current deployment.\n'
else
  printf 'Preview deployments will receive these defaults when Vercel creates them.\n'
fi
