import type { MoneyOSRuntime } from "@moneyos/core";
import type { Command } from "commander";

export interface MoneyOSCliContext {
  getRuntime(options?: {
    chainId?: number;
    requireSession?: boolean;
  }): Promise<MoneyOSRuntime>;
}

export interface MoneyOSCliTool {
  version: 1;
  name: string;
  commandPath: string[];
  description: string;
  createCommand(ctx: MoneyOSCliContext): Command;
}
