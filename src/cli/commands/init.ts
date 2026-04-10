import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadFileConfig, saveConfig, getConfigPath } from "../config.js";

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

    const privateKey = options.key ?? generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const config = {
      ...existing,
      privateKey,
      chainId: options.chain ? parseInt(options.chain) : existing.chainId ?? 42161,
      rpcUrl: options.rpc ?? existing.rpcUrl,
    };

    saveConfig(config);

    console.log(`MoneyOS initialized.`);
    console.log(`Address: ${account.address}`);
    console.log(`Config:  ${getConfigPath()}`);

    if (!options.key) {
      console.log(`\nThis is a new account. Fund it before sending transactions.`);
    }
  });
