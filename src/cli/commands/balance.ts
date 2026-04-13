import { Command } from "commander";
import { listTokens } from "@moneyos/core";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import type { Address } from "viem";
import { buildCliMoneyOSConfig, loadCliAddress } from "../wallet.js";

export const balanceCommand = new Command("balance")
  .description("Check token balance")
  .argument("[token]", "Token symbol (e.g. USDC, ETH, RYZE). Omit with --all.")
  .option("-a, --address <address>", "Address to check (defaults to your own)")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .option("--all", "Show balances for every built-in token on the selected chain")
  .action(async (token: string | undefined, options) => {
    if (options.all && token !== undefined) {
      console.error("Cannot combine a token argument with --all.");
      process.exitCode = 1;
      return;
    }
    if (!options.all && token === undefined) {
      console.error("Missing token. Pass a token symbol or use --all.");
      process.exitCode = 1;
      return;
    }

    const config = loadConfig();
    const chainId = options.chain ? parseInt(options.chain) : config.chainId;
    let address = options.address as Address | undefined;

    let moneyos: MoneyOS;
    try {
      if (!address) {
        const resolved = await loadCliAddress(config);
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

    if (options.all) {
      const resolvedChainId = chainId ?? 42161;
      const candidates = listTokens(resolvedChainId);
      if (candidates.length === 0) {
        console.error(
          `No built-in tokens registered on chain ${resolvedChainId}.`,
        );
        process.exitCode = 1;
        return;
      }

      const results = await Promise.allSettled(
        candidates.map((t) =>
          moneyos.balance(t.symbol, { address, chainId: resolvedChainId }),
        ),
      );

      const width = Math.max(...candidates.map((t) => t.symbol.length));
      let anyFailed = false;
      results.forEach((result, i) => {
        const symbol = candidates[i].symbol.padEnd(width);
        if (result.status === "fulfilled") {
          console.log(`${symbol}  ${result.value.amount}`);
        } else {
          anyFailed = true;
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.log(`${symbol}  error: ${message}`);
        }
      });
      if (anyFailed) process.exitCode = 1;
      return;
    }

    const result = await moneyos.balance(token as string, {
      address,
      chainId,
    });

    console.log(`${result.amount} ${result.symbol}`);
  });
