# Desktop Release

This runbook owns the standalone macOS artifact and its over-the-air update
channel. It does not enable the future hosted workspace mode.

## What ships

`bun run build:desktop` prepares the current-platform Convex bundle, builds the
renderer and model runtime, and runs electron-builder. The macOS release command
builds a universal application:

```sh
bun run release:desktop:mac
```

The application contains the renderer, model runtime, checksum-pinned Convex
arm64 and x64 binaries, exact Convex CLI/runtime dependencies, function source,
native esbuild helpers, and the Convex backend license. Build preparation needs
network access; an installed application does not download Convex or npm
packages on first launch.

The Convex backend currently uses the FSL-1.1-Apache-2.0 license. Preserve the
bundled notice and obtain legal review of its competing-use terms before a
commercial distribution decision.

## Development

```sh
cp .env.example .env.local
bun install
bun run dev:desktop
```

That single command selects isolated ports, starts anonymous development
Convex and Vite, and launches Electron. Vite hot-reloads the renderer. Changes
under `apps/desktop/src` or `apps/runtime/src` restart Electron and its owned
runtime. `bun run dev:desktop:shell` is only for attaching Electron to a stack
that is already listening at `ELECTRON_START_URL`.

## One-time release setup

Keep `indefinite-horizon/montecarlo` public. GitHub Releases in this repository
are both the DMG download page and the anonymous OTA feed, so installed
applications never need an embedded GitHub credential.

Create a protected GitHub Actions environment named `desktop-release`, allow
deployments only from `main`, require explicit approval, and configure these
environment secrets there (not as repository-level secrets):

| Secret | Purpose |
| --- | --- |
| `DESKTOP_CSC_LINK` | Base64-encoded Developer ID Application PKCS#12 certificate |
| `DESKTOP_CSC_KEY_PASSWORD` | Password for the PKCS#12 signing certificate |
| `DESKTOP_APPLE_API_KEY_ID` | App Store Connect API key identifier |
| `DESKTOP_APPLE_API_ISSUER` | App Store Connect API issuer identifier |
| `DESKTOP_APPLE_API_KEY_P8_BASE64` | Base64-encoded notarization API private key |

Never put these in `.env.local`, Convex, the renderer, release assets, or the
application bundle. Keep the release job attached to the protected environment
so GitHub withholds the credentials until approval. The same-repository
workflow writes releases with its short-lived `GITHUB_TOKEN` and a job-scoped
`contents: write` permission.

## Prepare a release

Run `/create-release <major|minor|patch>` from a clean branch based on the code
being released. The skill reviews the complete diff and associated PRs since
the latest published stable release, synchronizes every workspace package
version across the app and pinned desktop bundle, writes
`docs/releases/v<version>.md`, and opens an explicit release PR. The committed
release notes and version bump are the review boundary.

After the release PR is merged, copy its exact commit SHA from `main` and pass
it as `source_sha` when dispatching `.github/workflows/desktop-release.yml` from
`main`. The protected workflow creates the exact source tag first, then creates
and owns the matching asset-free draft; GitHub Actions tokens cannot access
drafts created by a human account.
This stays safe if other PRs land before the workflow starts: the
workflow checks out the requested commit and requires it to be the isolated
version/changelog commit on `main`'s first-parent history. The workflow:

1. requires all signing secrets and this public repository;
2. validates the App Store Connect credentials with Apple before starting the
   long universal build, then verifies the exact source commit introduced only the synchronized version,
   lockfile, and changelog, creates or verifies an immutable tag at that SHA,
   then creates or resumes its matching draft without asking the Releases API
   to create a tag from an older workflow revision;
3. compares the committed compatibility policy with the last release;
4. builds the universal app, DMG, and ZIP exactly once without publishing,
   notarizes the app during packaging, then separately notarizes and staples
   the signed DMG;
5. validates the app ID, arm64/x64 slices, Developer ID signatures, stapled
   app and DMG notarization tickets, updater metadata, recomputed ZIP SHA-512
   and byte size, signing team, and data layout;
6. launches the signed package with Node, Bun, and Convex removed from the
   application's `PATH` (the Playwright process still uses Actions' Node), sends
   a UI message through the real bundled runtime and a deterministic Codex
   protocol fixture, then reloads and verifies both turns persisted;
7. uploads the DMG, ZIP, both differential-download blockmaps,
   `latest-mac.yml`, and the compatibility manifest to the invisible draft,
   verifies the exact asset names, upload states, and byte sizes, rechecks the
   draft immediately before publication, and publishes last.

The protocol fixture replaces only the external Codex executable and provider
network. The renderer, preload IPC, model runtime, SSE normalization, bundled
Convex service, filesystem object store, and persistence/reload path are the
actual packaged implementations. CI must never use or upload a developer's
Codex credential cache.

Publishing that one verified GitHub draft is the atomic visibility boundary:
the DMG download and OTA metadata become public together. Draft releases are
not visible to updater clients. The ZIP and `latest-mac.yml` are required for
Electron's macOS updater even though users install the DMG initially. The ZIP
and DMG blockmaps enable differential downloads and are verified against the
same build. Do not delete or rename any of those assets.

## Update experience

The installed app checks the stable public feed and downloads a newer version
in the background. It does not prompt on `update-available`. After download, it
shows one persistent, dismissible **New update available** toast per app session
with **See changes** and **Restart**. Restart cleanly stops the local model and Convex processes, swaps
the signed application, and relaunches it.

The first signed version containing this updater is the bootstrap boundary and
must be installed from a DMG. Every supported version from that point onward can
jump directly to the current version. An app that shipped without updater code
cannot be made self-updating after the fact.

## Compatibility policy

Treat these values as permanent once the first release is public:

- `chat.montecarlo.desktop` application ID;
- `montecarlo` executable name and operating-system application-data location;
- Apple Developer ID TeamIdentifier;
- `indefinite-horizon/montecarlo`, provider, and `latest` channel;
- updater protocol and minimum compatible metadata version.
- checksum-pinned Convex backend release until an export/import migration path
  is implemented and tested.

`apps/desktop/release-compatibility.json` and the last release's generated
compatibility manifest enforce those invariants. Versions must increase. The
data layout is currently immutable: the build and release both fail if its
version or migration list changes. Expanding that policy requires a real
migration executor plus oldest-to-current leap fixtures in the same change.

The desktop supervisor additionally fails closed. Before a new function bundle
is pushed, it copies the stopped Convex data directory and records a pending
upgrade. On failure or interrupted launch it restores that snapshot. It refuses
to open a different Convex backend release or data-format version until code for
that migration exists; never bypass the refusal by editing the stored state.

No system can literally guarantee recovery from every corrupt disk, revoked
certificate, upstream defect, or lost signing identity. The supported promise
is signed artifacts, a tested direct migration path, a pre-migration snapshot,
rollback/refusal on failure, and draft metadata that is published last.

## Release checks

The desktop Playwright suite injects a normalized `update-downloaded` event
through the real Electron main-process IPC channel. It verifies the persistent
toast, close button, actions, suppression after dismissal, renderer reload,
and a macOS-style window close/reopen inside the same process, plus reappearance
after a fresh app session. Unit coverage verifies the electron-updater event,
main-process session claim, and install handoff, while the artifact gate
recomputes the DMG and update ZIP feed digests and validates their blockmaps.

Those checks do not pretend an unsigned development build can replace a signed
macOS application. Before relying on OTA for users, exercise the real updater
with two signed versions on a clean Mac:

On both Intel and Apple Silicon, use a machine with no global Node, Bun, Convex,
Codex, or Claude installation:

1. install the oldest supported signed DMG;
2. create representative chats, branches, and filesystem-backed bodies;
3. publish or point it at a candidate update feed;
4. wait until the downloaded-update toast appears;
5. open the changelog, then update and confirm relaunch;
6. verify the graph, hashes, local files, provider cancellation, and ability to
   launch with networking disabled.

Codex, Claude, and OpenRouter inference still requires the provider tooling,
credentials, and network those providers require. Ollama plus local persistence
is the fully offline execution path.
