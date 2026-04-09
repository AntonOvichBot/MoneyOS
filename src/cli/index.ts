import { Command } from "commander";
import { balanceCommand } from "./commands/balance.js";
import { sendCommand } from "./commands/send.js";
import { version } from "./version.js";

const program = new Command();

program
  .name("moneyos")
  .description("The operating system for money")
  .version(version);

program.addCommand(balanceCommand);
program.addCommand(sendCommand);

program.parse();
