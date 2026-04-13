export { MoneyOS } from "./core/client.js";

// Runtime implementations
export { ViemReadClient, EOAExecutor } from "./core/eoa.js";
export { LocalAccessAdapter } from "./core/access-local.js";

// KeyStores
export { FileKeyStore } from "./core/keystore-file.js";
export type { FileKeyStoreOptions } from "./core/keystore-file.js";

// Factory
export { createMoneyOS } from "./core/factory.js";
export { connectLocalSession } from "./local-session.js";
export type { MoneyOSCliContext, MoneyOSCliTool } from "./cli-tool.js";

// Re-export everything from @moneyos/core for backwards compatibility
export {
  chains,
  defaultChain,
  getChain,
  tokens,
  getToken,
  getTokenAddress,
  listTokens,
  NATIVE_TOKEN_ADDRESS,
} from "@moneyos/core";

export type {
  // Types
  MoneyOSConfig,
  Balance,
  SendResult,
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
