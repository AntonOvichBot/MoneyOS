import { Command } from "commander";
import { getChain } from "@moneyos/core";
import { MoneyOS } from "../../core/client.js";
import { OdosProvider } from "../../providers/odos.js";
import { loadConfig } from "../config.js";

export const swapCommand = new Command("swap")
  .description("Swap tokens")
  .argument("<amount>", "Amount to swap (e.g. 100)")
  .argument("<tokenIn>", "Token to sell (e.g. USDC)")
  .argument("<tokenOut>", "Token to buy (e.g. RYZE)")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .option("-s, --slippage <percent>", "Slippage tolerance in percent (default: 1)")
  .action(async (amount: string, tokenIn: string, tokenOut: string, options) => {
    const config = loadConfig();

    if (!config.privateKey) {
      console.error("No private key configured. Run: moneyos init");
      process.exit(1);
    }

    const chainId = options.chain
      ? parseInt(options.chain)
      : config.chainId ?? 42161;

    const moneyos = new MoneyOS({
      chainId,
      rpcUrl: config.rpcUrl,
      privateKey: config.privateKey,
    });

    const provider = new OdosProvider();
    const chain = getChain(chainId);
    const slippage = options.slippage ? parseFloat(options.slippage) : undefined;

    console.log(
      `Swapping ${amount} ${tokenIn.toUpperCase()} \u2192 ${tokenOut.toUpperCase()} on ${chain?.name ?? chainId}...`,
    );

    const result = await moneyos.swap(tokenIn, tokenOut, amount, provider, {
      chainId,
      slippage,
    });

    console.log(`Swapped. Expected: ~${result.amountOut} ${result.tokenOut}`);
    console.log(`tx: ${result.hash}`);
  });
