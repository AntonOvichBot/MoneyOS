import { Command } from "commander";
import type { AssetRegistry, MoneyOSRuntime, ReadClient } from "@moneyos/core";
import type { ConnectLocalSessionOptions } from "../../local-session.js";
import { connectLocalSession } from "../../local-session.js";
import { ViemReadClient } from "../../core/eoa.js";
import { DefaultAssetRegistry } from "../../core/assets.js";
import { createNoExecutorClient } from "../../core/no-executor.js";
import type { CLIConfig } from "../config.js";
import { loadConfig } from "../config.js";
import type { MoneyOSCliContext } from "../../cli-tool.js";

export interface CreateMoneyOSCliContextDependencies {
  loadConfig: () => CLIConfig;
  connectLocalSession: (
    options?: ConnectLocalSessionOptions,
  ) => Promise<MoneyOSRuntime["execute"]>;
  createReadClient: (params: {
    chainId: number;
    rpcUrl?: string;
  }) => ReadClient;
  createAssets: () => AssetRegistry;
}

const defaultCreateMoneyOSCliContextDependencies: CreateMoneyOSCliContextDependencies = {
  loadConfig,
  connectLocalSession,
  createReadClient: ({ chainId, rpcUrl }) =>
    new ViemReadClient({
      defaultChainId: chainId,
      rpcUrl,
    }),
  createAssets: () => new DefaultAssetRegistry(),
};

export function createMoneyOSCliContext(
  deps: CreateMoneyOSCliContextDependencies = defaultCreateMoneyOSCliContextDependencies,
): MoneyOSCliContext {
  return {
    Command,
    async getRuntime(options = {}): Promise<MoneyOSRuntime> {
      const config = deps.loadConfig();
      const chainId = options.chainId ?? config.chainId ?? 42161;
      const rpcUrl = config.rpcUrl;

      return {
        read: deps.createReadClient({ chainId, rpcUrl }),
        execute: options.requireSession
          ? await deps.connectLocalSession()
          : createNoExecutorClient(),
        assets: deps.createAssets(),
        config: {
          defaultChainId: chainId,
          rpcUrl,
        },
      };
    },
  };
}
