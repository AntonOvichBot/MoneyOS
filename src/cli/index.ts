import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { balanceCommand } from "./commands/balance.js";
import { sendCommand } from "./commands/send.js";
import { swapCommand } from "./commands/swap.js";
import { keystoreCommand } from "./commands/keystore.js";
import { version } from "./version.js";

const program = new Command();

program
  .name("moneyos")
  .description("The operating system for money")
  .version(version);

program.addCommand(initCommand);
program.addCommand(balanceCommand);
program.addCommand(sendCommand);
program.addCommand(swapCommand);
program.addCommand(keystoreCommand);

program.parse();
