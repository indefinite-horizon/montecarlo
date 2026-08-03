---
description: Never pass secrets or tokens as Convex action arguments — they appear in dashboard logs
globs: convex/**/*.ts
alwaysApply: false
---

# Do not pass sensitive credentials as action arguments

Convex logs action arguments to the deployment dashboard. Never pass secrets,
tokens, private keys, or other credentials as arguments to `ctx.runAction()` or
`internalAction` handlers — they will be visible in plaintext to anyone with
dashboard or log access.

## Instead

Read the credential from the database or environment **inside** the action
handler, as close to the point of use as possible.

### Anti-pattern

```ts
// BAD — token appears in Convex function logs
const creds = await mintGitCredentials(ctx, connection, repo);
await ctx.runAction(internal.actions.codingSandboxNode.gitPush, {
  providerSandboxId: sandboxId,
  repoPath,
  username: creds.username,
  password: creds.password,   // ← logged by Convex
});
```

### Accepted pattern

```ts
// GOOD — action resolves credentials internally; nothing secret in args
await ctx.runAction(internal.actions.codingSandboxNode.gitPush, {
  providerSandboxId: sandboxId,
  repoPath,
  connectionId,  // DB reference — not a secret
});

// Inside the action handler:
handler: async (ctx, args) => {
  const creds = await mintCredentialsFromConnection(args.connectionId);
  // use creds.token locally — never returned or logged
};
```

## Scope

This rule applies to all files under `convex/`. The same principle applies to
any value that would be damaging if exposed in logs: API keys, OAuth tokens,
PEM private keys, encryption keys, and user passwords.

## Exceptions

- Environment variables read via `env.SOME_SECRET` inside a `"use node"` action
  are acceptable — they don't appear in call arguments.
- The `env:` field on sandbox exec commands (e.g., `{ GH_TOKEN: token }`) is an
  accepted mitigation when the sandbox API passes env vars out-of-band from the
  logged command string.
