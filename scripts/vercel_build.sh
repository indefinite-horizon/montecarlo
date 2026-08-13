#!/usr/bin/env bash
# Vercel build script: deploys Convex backend and builds the web frontend.
# Handles both production and preview environments.
set -euo pipefail

: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY secret is not set}"

# ---------------------------------------------------------------------------
# Derive release metadata stamped into the client bundle and manifest
# ---------------------------------------------------------------------------
APP_RELEASE_ID="${VERCEL_DEPLOYMENT_ID:-${VERCEL_GIT_COMMIT_SHA:-local-dev}}"
APP_RELEASE_CHANNEL="${VERCEL_ENV:-development}"
APP_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA:-}"
APP_VERSION="$(node -p "require('./package.json').version")"

export APP_RELEASE_CHANNEL
export VITE_APP_RELEASE_ID="$APP_RELEASE_ID"
export VITE_APP_RELEASE_CHANNEL="$APP_RELEASE_CHANNEL"
export VITE_APP_COMMIT_SHA="$APP_COMMIT_SHA"
export VITE_APP_VERSION="$APP_VERSION"

echo "==> Release: id=$APP_RELEASE_ID channel=$APP_RELEASE_CHANNEL sha=$APP_COMMIT_SHA version=$APP_VERSION"

# For preview deploys, CONVEX_URL and CONVEX_SITE_URL are injected by
# `convex deploy --cmd` into the subprocess environment.  We forward them as
# VITE_ prefixed vars so Vite statically inlines them into the client bundle.
PREVIEW_BUILD_CMD='export VITE_CONVEX_URL="$CONVEX_URL" VITE_CONVEX_SITE_URL="$CONVEX_SITE_URL" && echo "==> VITE_CONVEX_URL=$VITE_CONVEX_URL" && echo "==> VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL" && bun run build:web'

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "==> Production deploy: deploying Convex + building frontend"
  # Production `convex deploy` compares indexes and queries table sizes before
  # dropping any. Vercel is non-interactive, so confirm large-index deletion
  # here. The production CONVEX_DEPLOY_KEY must include deployment:deploy,
  # deployment:data:view, and deployment:env:write; deploy-only keys fail the
  # table-size check with deployment:data:view.
  bunx convex deploy --typecheck enable --allow-deleting-large-indexes --cmd 'bun run build:web'
  echo "==> Setting APP_RELEASE_CHANNEL=$APP_RELEASE_CHANNEL on production"
  bunx convex env set APP_RELEASE_CHANNEL "$APP_RELEASE_CHANNEL"
  echo "==> Setting GIT_SHA=$APP_COMMIT_SHA on production"
  bunx convex env set GIT_SHA "$APP_COMMIT_SHA"
else
  # Replace slashes with dashes for valid Convex preview names
  PREVIEW_NAME="${VERCEL_GIT_COMMIT_REF//\//-}"
  echo "==> Preview deploy: deploying Convex preview '$PREVIEW_NAME' + building frontend"
  bunx convex deploy --typecheck enable --cmd "$PREVIEW_BUILD_CMD" --preview-name "$PREVIEW_NAME"
  echo "==> Setting SITE_URL=https://${VERCEL_URL} on preview"
  bunx convex env set --preview-name "$PREVIEW_NAME" SITE_URL "https://${VERCEL_URL}"
  echo "==> Setting APP_RELEASE_CHANNEL=$APP_RELEASE_CHANNEL on preview"
  bunx convex env set --preview-name "$PREVIEW_NAME" APP_RELEASE_CHANNEL "$APP_RELEASE_CHANNEL"
  echo "==> Setting GIT_SHA=$APP_COMMIT_SHA on preview"
  bunx convex env set --preview-name "$PREVIEW_NAME" GIT_SHA "$APP_COMMIT_SHA"
fi

# ---------------------------------------------------------------------------
# Write the live release manifest into the build output
# ---------------------------------------------------------------------------
node -e "
  const fs = require('fs');
  fs.writeFileSync('apps/web/dist/app-release.json', JSON.stringify({
    surface: 'web',
    channel: process.env.VITE_APP_RELEASE_CHANNEL,
    releaseId: process.env.VITE_APP_RELEASE_ID,
    commitSha: process.env.VITE_APP_COMMIT_SHA,
    version: process.env.VITE_APP_VERSION,
    builtAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }, null, 2));
"
echo "==> Wrote apps/web/dist/app-release.json"
