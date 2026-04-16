import { Command } from "commander";
import { listTokens } from "@moneyos/core";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import type { Address } from "viem";
import {
  buildCliMoneyOSConfig,
  resolveCliOwnedAddresses,
} from "../wallet.js";

interface BalanceTarget {
  address: Address;
  label?: "EOA" | "Smart account";
}

function shortenAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTargetLabel(target: BalanceTarget): string {
  return `${target.label} (${shortenAddress(target.address)}):`;
}

function targetLineWidth(targets: BalanceTarget[]): number {
  return Math.max(...targets.map((target) => formatTargetLabel(target).length));
}

async function resolveBalanceTargets(
  config: ReturnType<typeof loadConfig>,
  chainId: number,
  address?: Address,
): Promise<BalanceTarget[]> {
  if (address) {
    return [{ address }];
  }

  const resolved = await resolveCliOwnedAddresses(config, { chainId });
  if (
    resolved.smartAccount &&
    resolved.smartAccount.toLowerCase() !== resolved.eoa.toLowerCase()
  ) {
    return [
      { label: "EOA", address: resolved.eoa },
      { label: "Smart account", address: resolved.smartAccount },
    ];
  }

  return [{ address: resolved.eoa }];
}

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
    const chainId = options.chain ? parseInt(options.chain) : (config.chainId ?? 42161);
    const address = options.address as Address | undefined;

    let moneyos: MoneyOS;
    let targets: BalanceTarget[];
    try {
      targets = await resolveBalanceTargets(config, chainId, address);
      moneyos = new MoneyOS(
        await buildCliMoneyOSConfig(config, {
          chainId,
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
      const candidates = listTokens(chainId);
      if (candidates.length === 0) {
        console.error(
          `No built-in tokens registered on chain ${chainId}.`,
        );
        process.exitCode = 1;
        return;
      }

      let anyFailed = false;
      for (const [index, target] of targets.entries()) {
        if (target.label) {
          if (index > 0) console.log("");
          console.log(formatTargetLabel(target));
        }

        const results = await Promise.allSettled(
          candidates.map((candidate) =>
            moneyos.balance(candidate.symbol, { address: target.address, chainId }),
          ),
        );

        const width = Math.max(...candidates.map((candidate) => candidate.symbol.length));
        results.forEach((result, resultIndex) => {
          const symbol = candidates[resultIndex].symbol.padEnd(width);
          if (result.status === "fulfilled") {
            console.log(`${symbol}  ${result.value.amount}`);
            return;
          }

          anyFailed = true;
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.log(`${symbol}  error: ${message}`);
        });
      }

      if (anyFailed) process.exitCode = 1;
      return;
    }

    if (targets.length === 1) {
      const result = await moneyos.balance(token as string, {
        address: targets[0].address,
        chainId,
      });

      console.log(`${result.amount} ${result.symbol}`);
      return;
    }

    const width = targetLineWidth(targets);
    const results = await Promise.all(
      targets.map((target) =>
        moneyos.balance(token as string, {
          address: target.address,
          chainId,
        }),
      ),
    );

    results.forEach((result, index) => {
      console.log(
        `${formatTargetLabel(targets[index]).padEnd(width)}  ${result.symbol} ${result.amount}`,
      );
    });
  });
