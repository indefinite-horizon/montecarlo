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

Create `indefinite-horizon/montecarlo-releases` as a **public** GitHub
repository. The source repository is private, but installed applications must
be able to read update metadata without embedding a GitHub credential.

Configure these Actions secrets in the source repository:

| Secret | Purpose |
| --- | --- |
| `DESKTOP_RELEASE_TOKEN` | Writes releases to the public update repository |
| `DESKTOP_CSC_LINK` | Developer ID Application certificate consumed by electron-builder |
| `DESKTOP_CSC_KEY_PASSWORD` | Password for the signing certificate |
| `DESKTOP_APPLE_API_KEY_ID` | App Store Connect API key identifier |
| `DESKTOP_APPLE_API_ISSUER` | App Store Connect API issuer identifier |
| `DESKTOP_APPLE_API_KEY_P8_BASE64` | Base64-encoded notarization API private key |

Never put these in `.env.local`, Convex, the renderer, release assets, or the
application bundle.

## Main-branch release

`.github/workflows/desktop-release.yml` runs after the `CI` workflow succeeds on
`main`, and can also be dispatched manually. It:

1. requires all signing/publishing secrets and a public update repository;
2. chooses a semantic version greater than the latest published release;
3. compares the committed compatibility policy with the last release;
4. builds a universal signed and notarized DMG and ZIP;
5. leaves electron-builder's upload as a draft while it validates the app ID,
   arm64/x64 slices, Developer ID signatures, stapled notarization ticket,
   updater metadata, SHA-512 digests, signing team, and data layout;
6. launches the signed package with Node, Bun, and Convex removed from the
   application's `PATH` (the Playwright process still uses Actions' Node), sends
   a UI message through the real bundled runtime and a deterministic Codex
   protocol fixture, then reloads and verifies both turns persisted;
7. uploads the compatibility manifest and publishes the release only after all
   gates pass.

The protocol fixture replaces only the external Codex executable and provider
network. The renderer, preload IPC, model runtime, SSE normalization, bundled
Convex service, filesystem object store, and persistence/reload path are the
actual packaged implementations. CI must never use or upload a developer's
Codex credential cache.

The ZIP and `latest-mac.yml` are required for Electron's macOS updater even
though users install the DMG initially. Do not delete or rename those assets.

## Update experience

The installed app checks the stable public feed and downloads a newer version
in the background. It does not prompt on `update-available`. After download, it
shows one persistent, dismissible toast per app session with **See changelog**
and **Update**. Update cleanly stops the local model and Convex processes, swaps
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
- `indefinite-horizon/montecarlo-releases`, provider, and `latest` channel;
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

Before relying on OTA for users, exercise the release on a clean Intel and Apple
Silicon Mac with no global Node, Bun, Convex, Codex, or Claude installation:

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
