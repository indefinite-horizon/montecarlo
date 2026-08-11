#!/usr/bin/env bash
# Generates deployment inputs without crossing secret ownership boundaries.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/generate_deploy_env.sh [--force] [--rotate-generated-secrets] <prod|preview> [target-directory]

Defaults to ~/code/montecarlo. Writes environment-specific files such as:
  .env.prod                  Convex backend and Vercel deployment inputs
  .env.runtime.prod          Runtime-only blob attestation private key
  .env.preview               Convex defaults and Vercel preview inputs
  .env.runtime.preview       Runtime-only preview attestation private key

Existing non-empty values are preserved by default and only missing values are
prompted for. Use --force to re-prompt configurable values, or
--rotate-generated-secrets to replace generated secrets and attestation keys.
EOF
}

force=false
rotate_generated_secrets=false
deployment_environment=""
target_directory="${HOME}/code/montecarlo"
while (($# > 0)); do
  case "$1" in
    --force)
      force=true
      ;;
    --rotate-generated-secrets)
      force=true
      rotate_generated_secrets=true
      ;;
    prod | preview)
      if [[ -n "$deployment_environment" ]]; then
        printf 'Specify exactly one deployment environment.\n' >&2
        usage >&2
        exit 1
      fi
      deployment_environment="$1"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -* )
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      target_directory="$1"
      ;;
  esac
  shift
done

if [[ -z "$deployment_environment" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -d "$target_directory" ]]; then
  printf 'Target directory does not exist: %s\n' "$target_directory" >&2
  exit 1
fi

env_file="$target_directory/.env.$deployment_environment"
runtime_file="$target_directory/.env.runtime.$deployment_environment"
existing_files=false
if [[ -e "$env_file" || -e "$runtime_file" ]]; then
  if [[ ! -f "$env_file" || ! -f "$runtime_file" ]]; then
    if [[ "$rotate_generated_secrets" != true ]]; then
      printf 'Both existing env files are required for an idempotent update.\n' >&2
      printf 'Restore the missing file or use --rotate-generated-secrets.\n' >&2
      exit 1
    fi
  else
    existing_files=true
  fi
else
  existing_files=false
fi

for command_name in node openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command_name" >&2
    exit 1
  fi
done

if command -v git >/dev/null 2>&1 && git -C "$target_directory" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for filename in ".env.$deployment_environment" ".env.runtime.$deployment_environment"; do
    if ! git -C "$target_directory" check-ignore -q "$filename"; then
      printf '%s is not ignored by Git; refusing to write secrets.\n' "$filename" >&2
      exit 1
    fi
  done
fi

prompt_required() {
  local variable_name="$1"
  local label="$2"
  local default_value="${3:-}"
  local value=""
  while [[ -z "$value" ]]; do
    if [[ -n "$default_value" ]]; then
      read -r -p "$label [$default_value]: " value
      value="${value:-$default_value}"
    else
      read -r -p "$label: " value
    fi
  done
  printf -v "$variable_name" '%s' "$value"
}

prompt_secret() {
  local variable_name="$1"
  local label="$2"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -s -p "$label: " value
    printf '\n' >&2
  done
  printf -v "$variable_name" '%s' "$value"
}

prompt_optional() {
  local variable_name="$1"
  local label="$2"
  local default_value="${3:-}"
  local value=""
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " value
    value="${value:-$default_value}"
  else
    read -r -p "$label: " value
  fi
  printf -v "$variable_name" '%s' "$value"
}

prompt_optional_secret() {
  local variable_name="$1"
  local label="$2"
  local value=""
  read -r -s -p "$label: " value
  printf '\n' >&2
  printf -v "$variable_name" '%s' "$value"
}

validate_https_origin() {
  local label="$1"
  local value="$2"
  if ! node -e '
    const url = new URL(process.argv[1]);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) process.exit(1);
  ' "$value"; then
    printf '%s must be an HTTPS origin without a path, query, or fragment.\n' "$label" >&2
    exit 1
  fi
}

read_existing_value() {
  local source_file="$1"
  local requested_name="$2"
  local line name
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    if [[ "$name" == "$requested_name" ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <"$source_file"
  return 1
}

resolve_required() {
  local variable_name="$1"
  local env_name="$2"
  local label="$3"
  local default_value="${4:-}"
  local existing_value=""
  if [[ "$existing_files" == true ]]; then
    existing_value="$(read_existing_value "$env_file" "$env_name" || true)"
  fi
  if [[ "$force" != true && -n "$existing_value" ]]; then
    printf -v "$variable_name" '%s' "$existing_value"
  else
    prompt_required "$variable_name" "$label" "${existing_value:-$default_value}"
  fi
}

resolve_secret() {
  local variable_name="$1"
  local env_name="$2"
  local label="$3"
  local existing_value=""
  if [[ "$existing_files" == true ]]; then
    existing_value="$(read_existing_value "$env_file" "$env_name" || true)"
  fi
  if [[ "$force" != true && -n "$existing_value" ]]; then
    printf -v "$variable_name" '%s' "$existing_value"
  else
    prompt_secret "$variable_name" "$label"
  fi
}

resolve_optional_secret() {
  local variable_name="$1"
  local env_name="$2"
  local label="$3"
  local existing_value=""
  local existing_value_present=false
  if [[ "$existing_files" == true ]] && existing_value="$(
    read_existing_value "$env_file" "$env_name"
  )"; then
    existing_value_present=true
  fi
  if [[ "$force" != true && "$existing_value_present" == true ]]; then
    printf -v "$variable_name" '%s' "$existing_value"
  else
    prompt_optional_secret "$variable_name" "$label"
  fi
}

if [[ "$deployment_environment" == prod ]]; then
  resolve_required site_url SITE_URL "Production frontend origin (SITE_URL)"
else
  # SITE_URL is the hosted-auth browser origin used for callbacks, origin
  # validation, and CORS. The project default is a placeholder; each preview
  # deployment overrides it with the correct preview URL via vercel_build.sh.
  site_url="https://dummy-preview-siteurl.indefinitehorizon.com"
fi
validate_https_origin "SITE_URL" "$site_url"
site_url="${site_url%/}"

convex_url=""
convex_site_url=""
if [[ "$deployment_environment" == prod ]]; then
  resolve_required convex_url CONVEX_URL "Production Convex API origin (CONVEX_URL)"
  validate_https_origin "CONVEX_URL" "$convex_url"
  convex_url="${convex_url%/}"

  convex_site_default=""
  if [[ "$convex_url" == *.convex.cloud ]]; then
    convex_site_default="${convex_url%.convex.cloud}.convex.site"
  fi
  resolve_required convex_site_url \
    CONVEX_SITE_URL \
    "Production Convex site origin (CONVEX_SITE_URL)" \
    "$convex_site_default"
  validate_https_origin "CONVEX_SITE_URL" "$convex_site_url"
  convex_site_url="${convex_site_url%/}"
fi

google_client_id=""
google_client_secret=""
google_enabled=false
if [[ "$deployment_environment" == prod ]]; then
  existing_google_client_id=""
  existing_google_client_secret=""
  google_client_id_present=false
  google_client_secret_present=false
  if [[ "$existing_files" == true ]]; then
    if existing_google_client_id="$(read_existing_value "$env_file" GOOGLE_CLIENT_ID)"; then
      google_client_id_present=true
    fi
    if existing_google_client_secret="$(read_existing_value "$env_file" GOOGLE_CLIENT_SECRET)"; then
      google_client_secret_present=true
    fi
  fi
  if [[ "$force" != true && "$google_client_id_present" == true ]]; then
    google_client_id="$existing_google_client_id"
  else
    google_client_id_label="Google OAuth client ID (leave blank to disable)"
    if [[ -n "$existing_google_client_id" ]]; then
      google_client_id_label="Google OAuth client ID (enter 'none' to disable)"
    fi
    prompt_optional google_client_id "$google_client_id_label" "$existing_google_client_id"
    if [[ "$google_client_id" == none ]]; then
      google_client_id=""
    fi
  fi
  if [[ -n "$google_client_id" ]]; then
    if [[
      "$force" != true &&
      "$google_client_id" == "$existing_google_client_id" &&
      "$google_client_secret_present" == true &&
      -n "$existing_google_client_secret"
    ]]; then
      google_client_secret="$existing_google_client_secret"
    elif [[ "$google_client_id" == "$existing_google_client_id" && -n "$existing_google_client_secret" ]]; then
      prompt_optional_secret google_client_secret \
        "Google OAuth client secret (leave blank to preserve existing)"
      google_client_secret="${google_client_secret:-$existing_google_client_secret}"
    else
      prompt_secret google_client_secret "Google OAuth client secret"
    fi
    google_enabled=true
  fi
fi

resolve_secret convex_deploy_key CONVEX_DEPLOY_KEY "Convex $deployment_environment deploy key"
resolve_secret resend_api_key RESEND_API_KEY "Resend $deployment_environment API key"
resolve_required resend_from_email RESEND_FROM_EMAIL "Verified Resend sender email"
if [[ "$deployment_environment" == prod ]]; then
  resolve_secret posthog_project_token \
    POSTHOG_PROJECT_TOKEN \
    "PostHog production project token"
else
  resolve_optional_secret posthog_project_token \
    POSTHOG_PROJECT_TOKEN \
    "PostHog preview project token (leave blank to disable preview analytics)"
fi
resolve_required posthog_host \
  POSTHOG_HOST \
  "PostHog ingestion origin" \
  "https://us.i.posthog.com"
validate_https_origin "POSTHOG_HOST" "$posthog_host"
posthog_host="${posthog_host%/}"

if [[ "$resend_from_email" != *@*.* ]]; then
  printf 'RESEND_FROM_EMAIL must look like an email address.\n' >&2
  exit 1
fi

for value_name in \
  site_url \
  convex_url \
  convex_site_url \
  convex_deploy_key \
  resend_api_key \
  resend_from_email \
  posthog_project_token \
  posthog_host \
  google_client_id \
  google_client_secret; do
  value="${!value_name}"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    printf '%s contains a newline and cannot be written safely.\n' "$value_name" >&2
    exit 1
  fi
done

better_auth_secret=""
attestation_public_key=""
attestation_private_key=""
if [[ "$existing_files" == true && "$rotate_generated_secrets" != true ]]; then
  better_auth_secret="$(read_existing_value "$env_file" BETTER_AUTH_SECRET || true)"
  attestation_public_key="$(
    read_existing_value "$env_file" MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY || true
  )"
  attestation_private_key="$(
    read_existing_value "$runtime_file" MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY || true
  )"
fi
if [[ -z "$better_auth_secret" ]]; then
  better_auth_secret="$(openssl rand -base64 32 | tr -d '\n')"
fi
if [[ -z "$attestation_public_key" && -z "$attestation_private_key" ]]; then
  attestation_key_pair="$(
    node -e '
      const { generateKeyPairSync } = require("node:crypto");
      const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      console.log(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
      console.log(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"));
    '
  )"
  attestation_public_key="${attestation_key_pair%%$'\n'*}"
  attestation_private_key="${attestation_key_pair#*$'\n'}"
elif [[ -z "$attestation_public_key" || -z "$attestation_private_key" ]]; then
  printf 'The existing attestation key pair is incomplete.\n' >&2
  printf 'Restore the missing half or use --rotate-generated-secrets.\n' >&2
  exit 1
fi
release_channel="$deployment_environment"
if [[ "$deployment_environment" == prod ]]; then
  release_channel="production"
fi

umask 077
temporary_env_file="$(mktemp "$target_directory/.env.$deployment_environment.tmp.XXXXXX")"
temporary_runtime_file="$(mktemp "$target_directory/.env.runtime.$deployment_environment.tmp.XXXXXX")"
cleanup() {
  rm -f "$temporary_env_file" "$temporary_runtime_file"
}
trap cleanup EXIT

{
  printf '# Generated %s deployment inputs. Never commit this file.\n' "$deployment_environment"
  printf '# Convex backend variables\n'
  printf 'SITE_URL=%s\n' "$site_url"
  if [[ "$deployment_environment" == prod ]]; then
    printf 'CONVEX_URL=%s\n' "$convex_url"
    printf 'CONVEX_SITE_URL=%s\n' "$convex_site_url"
    printf 'GOOGLE_CLIENT_ID=%s\n' "$google_client_id"
    printf 'GOOGLE_CLIENT_SECRET=%s\n' "$google_client_secret"
  fi
  printf 'BETTER_AUTH_SECRET=%s\n' "$better_auth_secret"
  printf 'RESEND_API_KEY=%s\n' "$resend_api_key"
  printf 'RESEND_FROM_EMAIL=%s\n' "$resend_from_email"
  printf 'POSTHOG_PROJECT_TOKEN=%s\n' "$posthog_project_token"
  printf 'POSTHOG_HOST=%s\n' "$posthog_host"
  printf 'MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY=%s\n' "$attestation_public_key"
  printf 'APP_RELEASE_CHANNEL=%s\n' "$release_channel"
  printf 'ANALYTICS_DISABLED=false\n\n'
  printf '# Vercel %s variables\n' "$deployment_environment"
  printf 'CONVEX_DEPLOY_KEY=%s\n' "$convex_deploy_key"
  if [[ "$deployment_environment" == prod ]]; then
    printf 'VITE_CONVEX_URL=%s\n' "$convex_url"
    printf 'VITE_CONVEX_SITE_URL=%s\n' "$convex_site_url"
  fi
  printf 'VITE_POSTHOG_PROJECT_TOKEN=%s\n' "$posthog_project_token"
  printf 'VITE_POSTHOG_HOST=%s\n' "$posthog_host"
  printf 'VITE_AUTH_REQUIRED=true\n'
  printf 'VITE_AUTH_GOOGLE_ENABLED=%s\n' "$google_enabled"
  printf 'VITE_ANALYTICS_DISABLED=false\n'
  printf 'VITE_DEMO_MODE=false\n'
} >"$temporary_env_file"

cat >"$temporary_runtime_file" <<EOF
# Runtime-only $deployment_environment secret. Never upload this file to Convex or Vercel.
MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY=$attestation_private_key
EOF

mv "$temporary_env_file" "$env_file"
mv "$temporary_runtime_file" "$runtime_file"
chmod 600 "$env_file" "$runtime_file"
trap - EXIT

printf 'Wrote %s\n' "$env_file"
printf 'Wrote %s\n' "$runtime_file"
if [[ "$google_enabled" == true ]]; then
  printf 'Register this Google OAuth redirect URI:\n'
  printf '%s/api/auth/callback/google\n' "$convex_site_url"
fi
