# Architecture

Status: current-state package-boundary document. If another doc disagrees with
this file about what is shipped now, this file wins.

## Bare-metal core

`@moneyos/core` is the bare-metal core.

It owns only:

- runtime contracts: `read`, `execute`, `assets`, `config`
- shared value types
- chain and token registries
- keystore interfaces

It does not own:

- swap or any other tool-specific workflow
- provider clients, quote shapes, or routing policy
- CLI commands or local wallet/session behavior
- plugin, marketplace, or installer concerns

Rule: if a feature depends on a specific product workflow or external provider,
it is already above the core.

## Root package

`moneyos` is the root SDK and CLI package.

It owns:

- `MoneyOS` runtime composition
- default viem-based read and execute implementations
- encrypted local wallet, session, and backup flows
- workflow-author helpers that attach to an already-unlocked local session
- the root CLI surface, including `init`, `auth`, `backup`, `balance`,
  `send`, and `keystore`
- the `moneyos.runtime` seam that external tools execute against
- compatibility re-exports from `@moneyos/core`

It must not own:

- swap or other tool-specific workflows
- provider-specific integrations
- provider registries or installer flows
- CLI provider-selection UX
- best-price routing
- a general plugin framework

Rule: the root package should stay boring. If a feature can live as a separate
tool package, keep it out of root.

## Tool

A tool is a package above the core that implements one user-facing money
workflow against the runtime seam.

A tool:

- depends on `@moneyos/core`
- executes through `ActionContext` or `moneyos.runtime`
- owns workflow-specific logic, validation, and action surface
- may contain one or more providers

A tool is not:

- part of `@moneyos/core`
- automatically part of the root CLI or root SDK API
- a consumer of root session-management helpers such as `connectLocalSession`
- a provider registry or marketplace

Current example: `@moneyos/swap`.

## Provider

A provider is a tool-level adapter for one external protocol or service.

A provider:

- implements the contract the tool needs
- may carry provider-specific quote state
- stays behind the tool boundary

A provider is not:

- a root MoneyOS primitive
- a `@moneyos/core` concern
- something the root package should special-case

Current example: `OdosProvider` inside `@moneyos/swap`.

## Skill

A skill is a thin orchestration layer above tools. In practice, it is agent or
prompt logic that decides which tool to call and with what inputs.

A skill is not:

- part of the core runtime contract
- a provider
- a general plugin system

Rule: keep skills above the runtime. The runtime should not know or care which
agent recipe called it.

## Why swap moved out of root

Swap was moved out of root because swap is not a bare-metal primitive.

Swap needs:

- tool-specific approval flow
- provider-specific quote and calldata handling
- room for multiple providers over time

Keeping swap in root had three problems:

- it made Odos a root-level special case
- it pushed provider-shaped concerns into the wrong package
- it made the root SDK and CLI look more general than they really were

Moving swap into `@moneyos/swap` keeps the core honest and makes future
providers belong to the swap tool instead of the repo root.

## Deferred on purpose

These are intentionally not built yet:

- provider registry
- provider installer or marketplace
- CLI provider-selection UX
- best-price routing
- general plugin framework

Why they are deferred:

- there is only one real swap provider today
- a selection layer without real competing providers is fake abstraction
- routing policy is premature without multiple providers and clear tradeoffs
- a plugin framework before repeated pressure exists will calcify the wrong
  boundary

Rule: add the smallest next layer only when a real second provider or second
tool forces it.
