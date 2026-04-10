export { MoneyOS } from "./core/client.js";
export { OdosProvider } from "./providers/odos.js";

// Runtime implementations
export { ViemReadClient, EOAExecutor } from "./core/eoa.js";
export { LocalAccessAdapter } from "./core/access-local.js";

// KeyStores
export { FileKeyStore } from "./core/keystore-file.js";
export type { FileKeyStoreOptions } from "./core/keystore-file.js";

// 1Password plumbing
export { ChildProcessOpRunner } from "./core/op-runner.js";
export type {
  OpRunner,
  OpRunOptions,
  OpRunResult,
  ChildProcessOpRunnerOptions,
} from "./core/op-runner.js";
export {
  OnePasswordKeyStore,
  extractIds,
  buildInitTemplate,
  createInOnePassword,
  readPrivateKeyHex,
} from "./core/keystore-1password.js";
export type {
  OnePasswordKeyStoreOptions,
  CreateInOnePasswordOptions,
  CreateInOnePasswordResult,
} from "./core/keystore-1password.js";

// Factory
export { createMoneyOS } from "./core/factory.js";

// Re-export everything from @moneyos/core for backwards compatibility
export {
  chains,
  defaultChain,
  getChain,
  tokens,
  getToken,
  getTokenAddress,
  NATIVE_TOKEN_ADDRESS,
} from "@moneyos/core";

export type {
  // Types
  MoneyOSConfig,
  Balance,
  SendResult,
  SwapQuote,
  SwapResult,
  SwapProvider,
  Chain,
  Token,
  // Runtime
  MoneyOSRuntime,
  RuntimeConfig,
  CallRequest,
  ExecutionResult,
  ExecutionClient,
  ReadClient,
  AccessAdapter,
  AccessSession,
  SessionContext,
  MoneyOSAction,
  ActionContext,
  AssetRegistry,
  // KeyStore
  KeyStore,
  KeyStoreKind,
  KeyStoreMetadata,
} from "@moneyos/core";
