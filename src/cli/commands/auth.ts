import { Command } from "commander";
import {
  FileEncryptedWalletStore,
  type EncryptedWalletStore,
} from "../../core/encrypted-wallet.js";
import {
  type CLIConfig,
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

export interface ChangePasswordCommandDependencies {
  loadFileConfig: () => CLIConfig;
  getWalletPath: (config?: CLIConfig) => string;
  createWalletStore: (walletPath: string) => EncryptedWalletStore;
  promptHidden: (question: string) => Promise<string>;
  lockSession: (socketPath: string, tokenPath: string) => Promise<boolean>;
  getSessionSocketPath: () => string;
  getSessionTokenPath: () => string;
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultChangePasswordCommandDependencies: ChangePasswordCommandDependencies = {
  loadFileConfig,
  getWalletPath,
  createWalletStore: (walletPath) => new FileEncryptedWalletStore(walletPath),
  promptHidden,
  lockSession,
  getSessionSocketPath,
  getSessionTokenPath,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

export async function runChangePasswordCommand(
  deps: ChangePasswordCommandDependencies = defaultChangePasswordCommandDependencies,
): Promise<void> {
  const config = deps.loadFileConfig();
  const walletPath = deps.getWalletPath(config);
  const wallet = deps.createWalletStore(walletPath);

  if (!wallet.exists()) {
    deps.error("No encrypted wallet found. Run `moneyos init` first.");
    process.exitCode = 1;
    return;
  }

  try {
    const currentPassphrase = await deps.promptHidden("Current wallet password: ");
    if (currentPassphrase.length === 0) {
      throw new Error("Current wallet password cannot be empty.");
    }

    const newPassphrase = await deps.promptHidden("New wallet password: ");
    if (newPassphrase.length < 8) {
      throw new Error("New wallet password must be at least 8 characters long.");
    }
    if (newPassphrase === currentPassphrase) {
      throw new Error(
        "New wallet password must differ from the current password.",
      );
    }

    const confirmPassphrase = await deps.promptHidden(
      "Confirm new wallet password: ",
    );
    if (newPassphrase !== confirmPassphrase) {
      throw new Error("New wallet password confirmation did not match.");
    }

    const metadata = await wallet.rotatePassphrase({
      oldPassphrase: currentPassphrase,
      newPassphrase,
    });
    await deps.lockSession(
      deps.getSessionSocketPath(),
      deps.getSessionTokenPath(),
    );

    deps.log("Wallet password changed.");
    deps.log(`Address:   ${metadata.address}`);
    deps.log(formatSessionStatus({ state: "locked" }));
    deps.log(
      "Existing backup files and exported copies still require the old wallet password.",
    );
    deps.log(
      "Run `moneyos backup export` to create a backup encrypted with the new wallet password.",
    );
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export const authCommand = new Command("auth").description(
  "Unlock, inspect, lock, and change the local MoneyOS wallet password",
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
  .command("change-password")
  .description("Change the local wallet password and lock the current session")
  .action(async () => {
    await runChangePasswordCommand();
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
