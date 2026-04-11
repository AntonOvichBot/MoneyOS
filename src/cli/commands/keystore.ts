import { Command } from "commander";
import {
  loadFileConfig,
} from "../config.js";
import {
  formatWalletStatus,
  resolveWalletStatus,
} from "../wallet-status.js";

export const keystoreCommand = new Command("keystore").description(
  "Compatibility alias for wallet status",
);

keystoreCommand
  .command("status")
  .description("Show the current wallet storage status")
  .action(async () => {
    const config = loadFileConfig();
    const status = await resolveWalletStatus(config);
    console.log(formatWalletStatus(status));
  });
