export { MoneyOS } from "./core/client.js";
export { OdosProvider } from "./providers/odos.js";

// Runtime implementations
export { ViemReadClient, EOAExecutor } from "./core/eoa.js";
export { LocalAccessAdapter } from "./core/access-local.js";

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
} from "@moneyos/core";
