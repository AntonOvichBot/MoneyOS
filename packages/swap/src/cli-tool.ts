import type { MoneyOSRuntime } from "@moneyos/core";
import { OdosProvider } from "./providers/odos.js";
import { executeSwap } from "./tool.js";

type SwapCommandOptions = { chain?: string; provider?: string };
type CommandBuilder = { description(text: string): CommandBuilder; argument(usage: string, description?: string): CommandBuilder; option(flags: string, description?: string, defaultValue?: unknown): CommandBuilder; action(fn: (...args: [string, string, string, SwapCommandOptions]) => Promise<void>): CommandBuilder };

export const moneyosCliTool = {
  version: 1 as const,
  name: "swap",
  commandPath: ["swap"],
  description: "Swap tokens",
  createCommand(ctx: { Command: new (name?: string) => CommandBuilder; getRuntime(options?: { chainId?: number; requireSession?: boolean }): Promise<MoneyOSRuntime> }) {
    return new ctx.Command("swap")
      .description("Swap tokens through the installed MoneyOS swap tool")
      .argument("<amount>", "Amount to swap")
      .argument("<tokenIn>", "Input token symbol")
      .argument("<tokenOut>", "Output token symbol")
      .option("-c, --chain <chainId>", "Chain ID")
      .option("--provider <provider>", "Swap provider (default: odos)", "odos")
      .action(async (amount: string, tokenIn: string, tokenOut: string, options: SwapCommandOptions) => {
        let chainId: number | undefined;
        if (options.chain) {
          chainId = Number.parseInt(options.chain, 10);
          if (!Number.isInteger(chainId) || chainId <= 0) {
            throw new Error(`Invalid chain id "${options.chain}". Expected a positive integer.`);
          }
        }

        const runtime = await ctx.getRuntime({ chainId, requireSession: true });
        const result = await executeSwap(
          {
            amount,
            tokenIn,
            tokenOut,
            chainId: runtime.config.defaultChainId,
            provider: new OdosProvider({
              apiKey: process.env.MONEYOS_ODOS_API_KEY ?? process.env.ODOS_API_KEY,
            }),
          },
          runtime,
        );
        console.log(
          `Swapped ${result.amountIn} ${result.tokenIn} for ${result.amountOut} ${result.tokenOut}. tx: ${result.hash}`,
        );
      });
  },
};
