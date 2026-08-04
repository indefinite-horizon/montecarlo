#!/usr/bin/env bash
# Writes only Convex-owned variables from a dotenv file to stdout.

set -euo pipefail

ENV_FILE="${1:-.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found." >&2
  exit 1
fi

awk '
  /^[[:space:]]*(#|$)/ { print; next }
  {
    line = $0
    sub(/^[[:space:]]*export[[:space:]]+/, "", line)
    name = line
    sub(/[[:space:]]*=.*/, "", name)
  }
  name == "SITE_URL" ||
  name == "BETTER_AUTH_SECRET" ||
  name == "CONVEX_URL" ||
  name == "CONVEX_SITE_URL" ||
  name == "CONVEX_AGENT_MODE" ||
  name == "GOOGLE_CLIENT_ID" ||
  name == "GOOGLE_CLIENT_SECRET" ||
  name == "RESEND_API_KEY" ||
  name == "RESEND_FROM_EMAIL" ||
  name == "POSTHOG_PROJECT_TOKEN" ||
  name == "POSTHOG_HOST" ||
  name == "ANALYTICS_DISABLED" ||
  name == "MONTE_CARLO_BLOB_ATTESTATION_PUBLIC_KEY" ||
  name == "ENABLE_DANGEROUS_DEV_TOOLS" ||
  name == "ALLOW_LOCAL_ANONYMOUS_WORKSPACES" ||
  name == "GIT_SHA" ||
  name == "APP_RELEASE_CHANNEL" { print }
' "$ENV_FILE"
