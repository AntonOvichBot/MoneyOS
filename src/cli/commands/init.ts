import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { loadFileConfig, saveConfig, getConfigPath } from "../config.js";
import type { CLIConfig } from "../config.js";
import { ChildProcessOpRunner } from "../../core/op-runner.js";
import { createInOnePassword } from "../../core/keystore-1password.js";

type StoreKind = "file" | "1password";

function isValidStoreKind(value: unknown): value is StoreKind {
  return value === "file" || value === "1password";
}

export const initCommand = new Command("init")
  .description("Initialize MoneyOS with a new or existing account")
  .option("-k, --key <privateKey>", "Import an existing private key")
  .option("--chain <chainId>", "Default chain ID (default: 42161 Arbitrum)")
  .option("--rpc <url>", "Custom RPC URL")
  .option(
    "--store <kind>",
    "Key storage backend: 'file' (default) or '1password'",
    "file",
  )
  // Internal: path to the `op` binary. Undocumented in --help (commander
  // still shows it, but the description starts with INTERNAL to signal
  // that this is a test/smoke seam, not product UX). Not part of the
  // stable CLI contract.
  .option(
    "--op-binary <path>",
    "INTERNAL: path to the op CLI binary (for tests and smoke runs)",
  )
  .action(async (options) => {
    if (!isValidStoreKind(options.store)) {
      console.error(
        `Invalid --store value: "${options.store}". Must be "file" or "1password".`,
      );
      process.exitCode = 1;
      return;
    }
    const store: StoreKind = options.store;

    const existing = loadFileConfig();

    // --- Already-initialized short-circuits ---
    //
    // These preserve the v0.2 behavior for file-backed wallets and extend
    // the same "don't clobber an existing wallet unless the user asked"
    // UX to 1Password-backed wallets.

    if (existing.privateKey && !options.key) {
      const account = privateKeyToAccount(existing.privateKey);
      console.log(`Already initialized.`);
      console.log(`Address: ${account.address}`);
      console.log(`Config:  ${getConfigPath()}`);
      console.log(`\nTo reinitialize, run: moneyos init --key <privateKey>`);
      return;
    }

    const existingHas1PasswordWallet =
      existing.keyStore?.kind === "1password" &&
      Boolean(existing.keyStore.vaultId && existing.keyStore.itemId);

    if (existingHas1PasswordWallet && !options.key) {
      console.log(`Already initialized (1Password).`);
      if (existing.keyStore?.address) {
        console.log(`Address:  ${existing.keyStore.address}`);
      }
      console.log(`Vault ID: ${existing.keyStore?.vaultId}`);
      console.log(`Item ID:  ${existing.keyStore?.itemId}`);
      console.log(`Config:   ${getConfigPath()}`);
      console.log(
        `\nTo reinitialize, run: moneyos init --store 1password --key <privateKey>`,
      );
      return;
    }

    const privateKey: Hex = options.key ?? generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const chainId = options.chain
      ? parseInt(options.chain)
      : (existing.chainId ?? 42161);
    const rpcUrl = options.rpc ?? existing.rpcUrl;

    if (store === "file") {
      // --- Legacy file path — preserved exactly ---
      const config = {
        ...existing,
        privateKey,
        chainId,
        rpcUrl,
      };

      saveConfig(config);

      console.log(`MoneyOS initialized.`);
      console.log(`Address: ${account.address}`);
      console.log(`Config:  ${getConfigPath()}`);

      if (!options.key) {
        console.log(
          `\nThis is a new account. Fund it before sending transactions.`,
        );
      }
      return;
    }

    // --- 1Password path ---

    const runner = new ChildProcessOpRunner({
      binary: options.opBinary,
    });

    let result: Awaited<ReturnType<typeof createInOnePassword>>;
    try {
      result = await createInOnePassword({
        runner,
        privateKey,
        chainId,
      });
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }

    // Fresh config object — do NOT spread `existing` here, because we
    // must not leak a legacy `privateKey` field into the new
    // 1Password-backed config.
    const config: CLIConfig = {
      chainId,
      rpcUrl,
      keyStore: {
        kind: "1password",
        vaultId: result.vaultId,
        itemId: result.itemId,
        address: account.address,
      },
    };
    saveConfig(config);

    console.log(`MoneyOS initialized (1Password).`);
    console.log(`Address:  ${account.address}`);
    console.log(`Vault ID: ${result.vaultId}`);
    console.log(`Item ID:  ${result.itemId}`);
    console.log(`Config:   ${getConfigPath()}`);

    if (!options.key) {
      console.log(
        `\nThis is a new account. Fund it before sending transactions.`,
      );
    }
  });
