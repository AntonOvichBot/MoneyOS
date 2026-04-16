# Changelog

All notable changes to `@moneyos/swap` are documented here.

## 0.2.1 - 2026-04-16

### Fixed

- PR #101 restored atomic gasless approve plus swap batching for the session-backed path.
- PR #102 made exact-amount approve plus swap stay batched on batching executors.
- Added a client-side balance pre-check before quoting so swaps fail early with a clear insufficient-balance error for both ERC-20 and native inputs.

## 0.2.0 - 2026-04-12

### Added

- exported `moneyosCliTool`, making `moneyos swap` mountable through the root
  CLI after install

## 0.1.0 - 2026-04-12

### Added

- published the canonical swap package with `executeSwap`, `swapAction`,
  `createSwapTool`, and `OdosProvider`
