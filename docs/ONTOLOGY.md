# Ontology

| Term | Meaning |
| --- | --- |
| App user | Stable application identity linked to a Better Auth subject. |
| Workspace | Tenant and portability boundary. It is either local or cloud and owns projects, chats, blobs, and memberships. |
| Membership | A user's active or inactive role in one workspace. |
| Project | Optional grouping for chats. A chat belongs to at most one project. |
| Chat | A named conversation graph within one workspace. |
| Branch | One line of inquiry in a chat. It has at most one parent and stores only messages created on that branch. |
| Branch anchor | Provenance for a branch: parent/source IDs, optional selected text/range, and the prompt that opened it. |
| Lineage | Ordered path from a chat's root branch to one active branch. |
| Materialized context | Bounded provider input derived from lineage, source turn, selection, and branch prompt. |
| Message envelope | Versioned object containing full message content and parts. Convex stores its metadata and preview. |
| Blob manifest | Convex row mapping a portable object key to its backend, hash, size, and lifecycle. |
| Run | One provider generation attempt, with normalized status, usage, and error metadata. |
| Runtime session | Optional provider-native session/thread identity used only to accelerate later turns. |
| Local companion | Authenticated loopback process that owns model SDKs, provider keys, and filesystem objects. |
| Portable manifest | Versioned export index containing public IDs, entity files, object hashes, and schema/migration versions. |
| Managed provider key | Administrator-provisioned secret in a trusted runtime environment, never stored in the workspace or public browser bundle. |
