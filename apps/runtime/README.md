# Monte Carlo local runtime

The runtime is an authenticated loopback companion. Blob bodies stay outside Convex; callers
persist only the returned V1 manifest.

## Blob API

Portable keys must have the form `v1/workspaces/<workspace-public-id>/...` and contain only safe
ASCII path segments.

```text
PUT /v1/blobs/<portable-key>
Content-Type: application/json
X-Monte-Carlo-Envelope-Version: 1
X-Monte-Carlo-SHA256: <optional expected SHA-256 hex>
X-Monte-Carlo-Storage-Backend: filesystem | r2

<raw object bytes>
```

The response is `{ "manifest": ObjectManifestV1 }`. A manifest contains the contract version,
backend, portable key, SHA-256, byte length, media type, envelope version, and an optional opaque
storage version. It never contains an absolute path, bucket URL, or credential.

```text
GET /v1/blobs/<portable-key>
X-Monte-Carlo-Storage-Backend: filesystem | r2
```

The response is the original bytes with `Content-Type`, `Content-Length`, `ETag`,
`X-Monte-Carlo-Object-Store-Version`, `X-Monte-Carlo-Envelope-Version`, and
`X-Monte-Carlo-SHA256` headers. Both routes use the runtime's normal Origin and bearer-token
checks. The upload limit is 32 MiB.

## Storage configuration

- Filesystem storage is always available below `MONTE_CARLO_WORKSPACES_DIR`. If the directory is
  omitted, the runtime selects the platform application-data directory.
- `MONTE_CARLO_OBJECT_STORE=r2` or any R2 configuration enables R2 alongside filesystem and
  requires `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`;
  `R2_PREFIX` is optional.
- `MONTE_CARLO_RUNTIME_WORKSPACE_IDS` optionally restricts blob endpoints to a
  comma-separated set of workspace public IDs. A public shared runtime is not
  supported until requests use Better Auth-bound, workspace-scoped capabilities.

Filesystem writes use private directories, reject symlinked path components and targets, write
through an exclusive temporary file, sync it, and atomically rename it into place. Reads verify the
stored byte length and SHA-256. R2 uses the official AWS S3-compatible client and keeps integrity
metadata with each private object.
