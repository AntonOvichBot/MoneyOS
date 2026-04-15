import { Command } from "commander";
import { getChain } from "@moneyos/core";
import type { Address } from "viem";
import { isAddress } from "viem";
import { MoneyOS } from "../../core/client.js";
import { loadConfig } from "../config.js";
import { resolveContact } from "../contacts.js";
import { buildCliMoneyOSConfig } from "../wallet.js";

export function resolveSendRecipient(input: string): Address {
  if (isAddress(input)) {
    return input as Address;
  }

  const contact = resolveContact(input);
  if (contact) {
    console.log(`Resolved ${input} → ${contact}`);
    return contact;
  }

  throw new Error(
    `Could not resolve "${input}". Use a 0x address or add a contact with "moneyos contact set ${input} 0x...".`,
  );
}

export const sendCommand = new Command("send")
  .description("Send tokens to an address or a saved contact name")
  .argument("<amount>", "Amount to send (e.g. 10)")
  .argument("<token>", "Token symbol (e.g. USDC, ETH, RYZE)")
  .argument("<to>", "Recipient address (0x...) or saved contact name")
  .option("-c, --chain <chainId>", "Chain ID (default: 42161 Arbitrum)")
  .action(async (amount: string, token: string, to: string, options) => {
    const config = loadConfig();

    const chainId = options.chain
      ? parseInt(options.chain)
      : config.chainId ?? 42161;

    let recipient: Address;
    try {
      recipient = resolveSendRecipient(to);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    let moneyos: MoneyOS;
    try {
      moneyos = new MoneyOS(
        await buildCliMoneyOSConfig(config, {
          chainId,
          requireSigner: true,
        }),
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }

    const chain = getChain(chainId);
    console.log(
      `Sending ${amount} ${token.toUpperCase()} to ${recipient} on ${chain?.name ?? chainId}...`,
    );

    const result = await moneyos.send(token, recipient, amount, {
      chainId,
    });

    console.log(`Sent. tx: ${result.hash}`);
  });
