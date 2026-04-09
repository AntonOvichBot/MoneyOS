import { Command } from "commander";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import type { Address } from "viem";

export const balanceCommand = new Command("balance")
  .description("Check token balance")
  .argument("<token>", "Token symbol (e.g. USDC, ETH, RYZE)")
  .option("-a, --address <address>", "Address to check (defaults to your own)")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .action(async (token: string, options) => {
    const config = loadConfig();
    const chainId = options.chain ? parseInt(options.chain) : config.chainId;

    const moneyos = new MoneyOS({
      chainId: chainId ?? 42161,
      rpcUrl: config.rpcUrl,
      privateKey: options.address ? undefined : config.privateKey,
    });

    const address = options.address as Address | undefined;
    const result = await moneyos.balance(token, {
      address,
      chainId,
    });

    console.log(`${result.amount} ${result.symbol}`);
  });
