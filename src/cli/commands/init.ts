import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  getConfigPath,
  getRemovedOnePasswordStorageMessage,
  hasRemovedOnePasswordConfig,
  loadFileConfig,
  saveConfig,
} from "../config.js";

export const initCommand = new Command("init")
  .description("Initialize MoneyOS with a new or existing account")
  .option("-k, --key <privateKey>", "Import an existing private key")
  .option("--chain <chainId>", "Default chain ID (default: 42161 Arbitrum)")
  .option("--rpc <url>", "Custom RPC URL")
  .action(async (options) => {
    const existing = loadFileConfig();

    if (existing.privateKey && !options.key) {
      const account = privateKeyToAccount(existing.privateKey);
      console.log(`Already initialized.`);
      console.log(`Address: ${account.address}`);
      console.log(`Config:  ${getConfigPath()}`);
      console.log(`\nTo reinitialize, run: moneyos init --key <privateKey>`);
      return;
    }

    if (hasRemovedOnePasswordConfig(existing) && !options.key) {
      console.error(getRemovedOnePasswordStorageMessage());
      console.error(`Config: ${getConfigPath()}`);
      return;
    }

    const privateKey: Hex = options.key ?? generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const chainId = options.chain
      ? parseInt(options.chain)
      : (existing.chainId ?? 42161);
    const rpcUrl = options.rpc ?? existing.rpcUrl;

    saveConfig({
      chainId,
      rpcUrl,
      privateKey,
    });

    console.log(`MoneyOS initialized.`);
    console.log(`Address: ${account.address}`);
    console.log(`Config:  ${getConfigPath()}`);

    if (!options.key) {
      console.log(
        `\nThis is a new account. Fund it before sending transactions.`,
      );
    }
  });
