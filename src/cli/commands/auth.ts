import { Command } from "commander";
import { FileEncryptedWalletStore } from "../../core/encrypted-wallet.js";
import {
  getSessionSocketPath,
  getSessionTokenPath,
  getWalletPath,
  loadFileConfig,
} from "../config.js";
import { promptHidden } from "../prompt.js";
import {
  getSessionStatus,
  lockSession,
  startDetachedSessionDaemon,
} from "../session.js";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function formatSessionStatus(params: {
  state: "locked" | "unlocked";
  address?: string;
  expiresAt?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Session:   ${params.state}`);
  if (params.address) {
    lines.push(`Address:   ${params.address}`);
  }
  if (params.expiresAt) {
    lines.push(`Expires:   ${params.expiresAt}`);
  }
  return lines.join("\n");
}

export const authCommand = new Command("auth").description(
  "Unlock, inspect, and lock the local MoneyOS wallet session",
);

authCommand
  .command("unlock")
  .description("Unlock the local wallet and start a short-lived session")
  .action(async () => {
    const config = loadFileConfig();
    const walletPath = getWalletPath(config);
    const wallet = new FileEncryptedWalletStore(walletPath);

    if (!wallet.exists()) {
      console.error("No encrypted wallet found. Run `moneyos init` first.");
      process.exitCode = 1;
      return;
    }

    try {
      const passphrase = await promptHidden("Wallet password: ");
      if (passphrase.length === 0) {
        throw new Error("Wallet password cannot be empty.");
      }

      const privateKey = await wallet.decrypt(passphrase);
      const status = await startDetachedSessionDaemon({
        type: "start",
        privateKey,
        chainId: config.chainId ?? 42161,
        rpcUrl: config.rpcUrl,
        socketPath: getSessionSocketPath(),
        tokenPath: getSessionTokenPath(),
        ttlMs: DEFAULT_TTL_MS,
      });

      console.log("Wallet unlocked.");
      console.log(
        formatSessionStatus({
          state: "unlocked",
          address: status.address,
          expiresAt: status.expiresAt,
        }),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

authCommand
  .command("lock")
  .description("Lock the local MoneyOS wallet session")
  .action(async () => {
    const locked = await lockSession(
      getSessionSocketPath(),
      getSessionTokenPath(),
    );
    console.log(
      formatSessionStatus({
        state: "locked",
      }),
    );
    if (!locked) {
      console.log("No active local session was running.");
    }
  });

authCommand
  .command("status")
  .description("Show whether the local wallet session is unlocked")
  .action(async () => {
    const status = await getSessionStatus(
      getSessionSocketPath(),
      getSessionTokenPath(),
    );
    if (!status) {
      console.log(
        formatSessionStatus({
          state: "locked",
        }),
      );
      return;
    }

    console.log(
      formatSessionStatus({
        state: "unlocked",
        address: status.address,
        expiresAt: status.expiresAt,
      }),
    );
  });
