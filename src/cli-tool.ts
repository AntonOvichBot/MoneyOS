import { Command } from "commander";
import type { MoneyOSRuntime } from "@moneyos/core";

export interface MoneyOSCliContext {
  Command: typeof Command;
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
