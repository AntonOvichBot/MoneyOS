# ADR: Expose `connectLocalSession` in `moneyos`

## Status

Accepted.

## Decision

The daemon-backed local unlock session stays. The root `moneyos` package will
expose one explicit workflow-author helper:

```ts
connectLocalSession(opts?: {
  socketPath?: string;
  tokenPath?: string;
}): Promise<ExecutionClient>
```

This helper attaches to an already-unlocked local MoneyOS session and returns
an `ExecutionClient`. Callers then compose that executor into
`createMoneyOS({ chainId, execute })`.

## Why

- MoneyOS needs unlock-once / bounded-session behavior for multi-step
  workflows and future skills.
- Tool packages are not the audience for session helpers. Their seam remains
  `MoneyOSRuntime` from `@moneyos/core`.
- `moneyos` currently ships SDK and CLI as one package, so default session-path
  lookup inside that package is acceptable cohesion.

## Rejected alternatives

### `resolveLocalMoneyOSConfig()`

Rejected because it hides the signing path behind generic config resolution and
makes the SDK feel more magical than it should.

### Session-handle export/import

Rejected for the current single-package architecture because it adds extra user
ceremony, moves token material into env/tmp handling, and creates a serialized
userland contract where a function inside the same package is simpler.

### Killing the daemon

Rejected because passphrase-per-action breaks the unlock-once workflow model
needed for multi-step flows and future skill/workflow automation.

## Consequences

- Workflow and script authors can explicitly reuse a local unlocked session.
- Third-party tool authors still target `MoneyOSRuntime`, not root session
  helpers.
- Future scoped or policy-aware sessions can still fit because the root
  composition seam remains `ExecutionClient`.
