import { Command, InvalidArgumentError } from "commander";
import type { MoneyOSRuntime } from "@moneyos/core";
import type { SwapProvider } from "./types.js";
import { OdosProvider } from "./providers/odos.js";
import { executeSwap } from "./tool.js";

interface SwapCliContext {
  getRuntime(options?: {
    chainId?: number;
    requireSession?: boolean;
  }): Promise<MoneyOSRuntime>;
}

export interface CreateSwapCliCommandDependencies {
  executeSwap: typeof executeSwap;
  createProvider: (name: string) => SwapProvider;
  log: (message: string) => void;
}

const defaultCreateSwapCliCommandDependencies: CreateSwapCliCommandDependencies = {
  executeSwap,
  createProvider(name) {
    if (name !== "odos") {
      throw new Error(
        `Unsupported swap provider "${name}". Only "odos" is available in this release.`,
      );
    }

    return new OdosProvider({
      apiKey: process.env.MONEYOS_ODOS_API_KEY ?? process.env.ODOS_API_KEY,
    });
  },
  log: (message) => console.log(message),
};

function parseChainId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`Invalid chain id "${value}". Expected a positive integer.`);
  }

  return parsed;
}

export function createSwapCliCommand(
  ctx: SwapCliContext,
  deps: CreateSwapCliCommandDependencies = defaultCreateSwapCliCommandDependencies,
): Command {
  return new Command("swap")
    .description("Swap tokens through the installed MoneyOS swap tool")
    .argument("<amount>", "Amount to swap")
    .argument("<tokenIn>", "Input token symbol")
    .argument("<tokenOut>", "Output token symbol")
    .option("-c, --chain <chainId>", "Chain ID", parseChainId)
    .option("--provider <provider>", "Swap provider (default: odos)", "odos")
    .action(async (
      amount: string,
      tokenIn: string,
      tokenOut: string,
      options: {
        chain?: number;
        provider?: string;
      },
    ) => {
      const chainId = options.chain;
      const providerName = (options.provider ?? "odos").toLowerCase();
      const runtime = await ctx.getRuntime({
        chainId,
        requireSession: true,
      });

      const result = await deps.executeSwap(
        {
          amount,
          tokenIn,
          tokenOut,
          chainId: runtime.config.defaultChainId,
          provider: deps.createProvider(providerName),
        },
        runtime,
      );

      deps.log(
        `Swapped ${result.amountIn} ${result.tokenIn} for ${result.amountOut} ${result.tokenOut}. tx: ${result.hash}`,
      );
    });
}

export const moneyosCliTool = {
  version: 1 as const,
  name: "swap",
  commandPath: ["swap"],
  description: "Swap tokens",
  createCommand(ctx: SwapCliContext): Command {
    return createSwapCliCommand(ctx);
  },
};
