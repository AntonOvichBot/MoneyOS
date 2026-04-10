import { Command } from "commander";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import type { Address } from "viem";
import { buildCliMoneyOSConfig, loadCliAddress } from "../wallet.js";

export const balanceCommand = new Command("balance")
  .description("Check token balance")
  .argument("<token>", "Token symbol (e.g. USDC, ETH, RYZE)")
  .option("-a, --address <address>", "Address to check (defaults to your own)")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .option(
    "--op-binary <path>",
    "INTERNAL: path to the op CLI binary (for tests and smoke runs)",
  )
  .action(async (token: string, options) => {
    const config = loadConfig();
    const chainId = options.chain ? parseInt(options.chain) : config.chainId;
    let address = options.address as Address | undefined;

    let moneyos: MoneyOS;
    try {
      if (!address) {
        const resolved = await loadCliAddress(config, {
          opBinary: options.opBinary,
        });
        address = resolved.address;
      }

      moneyos = new MoneyOS(
        await buildCliMoneyOSConfig(config, {
          chainId: chainId ?? 42161,
          requireSigner: false,
        }),
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }

    const result = await moneyos.balance(token, {
      address,
      chainId,
    });

    console.log(`${result.amount} ${result.symbol}`);
  });
