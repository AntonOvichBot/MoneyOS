import { Command } from "commander";
import { getChain } from "@moneyos/core";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import type { Address } from "viem";
import { buildCliMoneyOSConfig } from "../wallet.js";

export const sendCommand = new Command("send")
  .description("Send tokens to an address")
  .argument("<amount>", "Amount to send (e.g. 10)")
  .argument("<token>", "Token symbol (e.g. USDC, ETH, RYZE)")
  .argument("<to>", "Recipient address")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .action(async (amount: string, token: string, to: string, options) => {
    const config = loadConfig();

    const chainId = options.chain
      ? parseInt(options.chain)
      : config.chainId ?? 42161;

    let moneyos: MoneyOS;
    try {
      moneyos = new MoneyOS(
        await buildCliMoneyOSConfig(config, {
          chainId,
          requireSigner: true,
        }),
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }

    const chain = getChain(chainId);
    console.log(
      `Sending ${amount} ${token.toUpperCase()} to ${to} on ${chain?.name ?? chainId}...`,
    );

    const result = await moneyos.send(token, to as Address, amount, {
      chainId,
    });

    console.log(`Sent. tx: ${result.hash}`);
  });
