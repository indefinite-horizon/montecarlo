# Provider Session Locking

Status: proposed direction; not implemented  
Last discussed: 2026-08-09

## Summary

Lock each branch to one provider after its first run. Switching providers becomes an explicit
"Branch with provider…" action that creates a child branch and a fresh provider-native session.

This keeps the application-owned chat DAG authoritative while allowing providers such as Codex
to retain their native session history, encrypted reasoning state, and native compaction. Providers
without usable native sessions or compaction use an application-owned materialized context.

The intended user-facing rule is:

> A branch is one provider-native conversation. Changing providers creates a branch.

## Why Change The Current Design

The current execution path builds the same bounded, provider-neutral context for every request and
starts a fresh provider session unless a provider thread ID is supplied. The web controller does not
currently send a provider thread ID or persist the streamed provider-thread event for reuse.

Current materialization limits are:

- 24 prior messages
- 120,000 characters total
- 32,000 characters per message
- 4,000 characters of selected branch text

This makes arbitrary provider/model switching straightforward, but prevents Codex from carrying its
native thread state and compaction across turns. Although the Codex runtime adapter can resume a
thread when given an ID, the current UI path does not use that capability. Claude also currently
starts a fresh CLI process with the materialized transcript.

## Recommended Model

### Provider ownership

- A new empty branch has no provider lock.
- Its first successful run selects and locks the provider.
- Later turns resume the same provider-native session when supported.
- Changing providers creates a child branch at a chosen source message.
- The child branch receives a portable context seed and starts a fresh native session.
- The full visible transcript and branch graph remain application-owned and reconstructable.
- Native sessions are disposable execution state, never the source of branch identity or semantics.

Lock the provider initially, not necessarily the model. Allow model changes within a branch only when
the provider documents that the same native session can safely continue with the new model. Otherwise,
make a model change create a branch as well.

### Why this is simpler than parallel provider lanes

An alternative would retain one native session per provider on every branch and synchronize missed
turns whenever the user switches back. That requires provider-lane cursors, catch-up envelopes,
native-session reconciliation, stale-session handling, and complicated branch/fork mapping.

Provider locking avoids that synchronization layer. Only one native session advances on a branch,
and crossing a provider boundary always creates an explicit, inspectable branch boundary.

## Native And Application-Owned Compaction

### Providers with native session compaction

For Codex:

- Persist the native thread ID returned by the runtime.
- Resume that thread for each later turn on the branch.
- Send only the new turn when resuming rather than replaying the materialized transcript.
- Allow Codex automatic compaction to operate normally.
- Consider explicit compaction through Codex app-server's `thread/compact/start` later; the immediate
  value comes from simply preserving and resuming the native thread.
- Use native `thread/fork` at a mapped turn when available and appropriate, but do not require it for
  application branching.

Add equivalent adapters only where another provider has a documented, stable native continuation and
compaction API. Do not pretend all provider session identifiers have interchangeable semantics.

Native compacted or encrypted state is provider-specific and opaque. It cannot be transferred into a
different provider and must not be treated as portable conversation data.

### Providers without native compaction

Treat OpenRouter and Ollama as application-managed context providers by default, even if a particular
OpenRouter upstream model happens to expose provider-specific state.

Persist the complete visible transcript, but send a disposable context projection containing:

1. Pinned instructions and the branch anchor.
2. A structured application-owned checkpoint for older context.
3. Recent uncompressed turns.
4. The current user prompt.

Trigger compaction from model-specific token budgets rather than character counts. Use headroom and
hysteresis so the application does not compact on every turn near the limit.

A checkpoint should preserve at least:

- goals and success criteria;
- user constraints and durable instructions;
- established facts and decisions;
- important artifacts, files, and relevant tool results;
- completed work;
- unresolved questions and next steps; and
- the message-ID range, version, and inputs from which it was produced.

Checkpoints are context projections, not ordinary user-visible chat messages. They must be disposable
and regenerable from canonical persisted data. Avoid repeatedly summarizing only the previous summary;
retain provenance and enough canonical source coverage to limit cumulative information loss.

## Cross-Provider Branch Handoff

Creating a child branch with a different provider still needs a portable seed, especially when the
source native session has already compacted history that the destination cannot read.

At branch creation:

1. Prefer asking the source provider, while its native session is available, for a structured portable
   handoff checkpoint.
2. Include recent visible turns, the branch anchor or selected passage, and the prompt opening the new
   branch.
3. Persist the handoff as application-owned branch context with provenance.
4. Start a fresh destination-provider session from that seed.
5. Fall back to generating a checkpoint from the persisted visible transcript if the source provider
   session is unavailable.

The handoff should export useful working state, not hidden chain-of-thought. Exact semantic continuity
cannot be guaranteed across providers because native encrypted reasoning and compaction are not portable.

## Data And Runtime Work

- [ ] Decide whether provider locking belongs directly on `chat_branches` or in a provider-neutral
      runtime-session record referenced by the branch.
- [ ] Store the provider ID and native session/thread ID needed to resume the branch.
- [ ] Keep native identifiers out of portable exports, or explicitly discard them during export/import.
- [ ] Capture `provider-thread` stream events and associate them with the correct running branch/run.
- [ ] Pass the saved native ID back to the runtime on later turns.
- [ ] Make session association idempotent and safe against retries, cancellation, and late stream events.
- [ ] Detect missing, expired, incompatible, or corrupt native sessions and rebuild from portable context.
- [ ] Define provider capability flags such as `nativeContinuation`, `nativeFork`, and `nativeCompaction`.
- [ ] Add a versioned schema for application-owned checkpoints and branch handoffs.
- [ ] Replace character-only context limits with model-aware token budgeting where app-owned context is used.
- [ ] Update architecture, ontology, portability, and security documentation with the final ownership rules.

## Product And UX Work

- [ ] Keep the provider picker enabled until the first run on an empty branch.
- [ ] After locking, show the provider as branch identity rather than a freely mutable per-turn setting.
- [ ] Replace cross-provider selection with a clear "Branch with provider…" action.
- [ ] Ensure the new branch route contains the complete workspace/chat/branch state.
- [ ] Decide whether changing models within the same provider continues the branch or creates another branch.
- [ ] Explain recovery when a provider-native session is unavailable without exposing implementation details.
- [ ] Consider a manual "Compact context" action only for app-managed providers if users need control.

## Suggested Implementation Phases

### Phase 1: Codex continuity

- Lock provider per branch.
- Capture and persist Codex thread IDs.
- Resume Codex threads on consecutive turns.
- Fall back to the existing bounded materialized context when resumption fails.

This phase restores native Codex auto-compaction without introducing explicit compaction controls.

### Phase 2: Provider-switch branching

- Change provider switching into branch creation.
- Generate and persist portable handoff checkpoints.
- Seed the destination provider from the checkpoint plus recent turns.
- Support native Codex fork optimization where a reliable app-turn mapping exists.

### Phase 3: App-owned compaction

- Add structured checkpoints for OpenRouter, Ollama, and other stateless adapters.
- Add provider/model-aware token budgets.
- Add compaction provenance, regeneration, and recovery behavior.

### Phase 4: Additional native adapters

- Add native continuation or compaction for other providers only after verifying stable official APIs.
- Keep each capability provider-specific behind the common runtime interface.

## Testing Expectations

- [ ] Unit-test provider-lock rules and provider/model transition decisions.
- [ ] Unit-test token budgeting, checkpoint construction, provenance, and deterministic fallback context.
- [ ] Runtime-test native thread capture, resume, cancellation, retry, and missing-session recovery.
- [ ] E2E-test first-turn locking and same-provider continuation.
- [ ] E2E-test "Branch with provider…" and verify parent/child transcripts do not leak later turns.
- [ ] E2E-test switching from a long/compacted source branch using a portable handoff.
- [ ] E2E-test app-owned compaction for OpenRouter/Ollama fixtures.
- [ ] Cover equivalent local-storage and cloud-storage flows because session metadata and portable
      checkpoints cross different persistence boundaries.
- [ ] Verify exports/imports work after native session IDs are removed or invalidated.

Consult `docs/TESTING.md` during implementation and keep the E2E suite MECE.

## Open Decisions

- Is the lock provider-only, or provider-and-model for the first release?
- Is a portable handoff generated automatically on every cross-provider branch, or only when the source
  context exceeds the destination's direct context budget?
- Which model generates app-owned checkpoints for OpenRouter/Ollama: the active model, a configured
  summarizer, or a deterministic local option?
- Should checkpoint generation be visible as a run, and how should failures/cost be presented?
- How much recent uncompressed context should accompany a checkpoint?
- Can Claude's supported local tooling provide a stable resumable-session contract suitable for this
  architecture, or should Claude initially use app-owned context?
- Should native provider forks be an optimization from the start or deferred until basic resume and
  recovery are proven?

## Invariants To Preserve

- The application-owned chat DAG is authoritative.
- A branch can be reconstructed without provider-native state.
- Provider credentials and credential caches never enter application persistence.
- Native sessions never define portable identity or branch semantics.
- Branch snapshots remain immutable: later parent turns cannot leak into an existing child.
- Complete visible messages remain stored even when execution context is compacted.
- Cross-provider handoffs never attempt to expose or transfer hidden reasoning.
