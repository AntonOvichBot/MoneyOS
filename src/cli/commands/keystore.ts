import * as readline from "node:readline/promises";
import { Command } from "commander";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { loadFileConfig, saveConfig, getConfigPath } from "../config.js";
import type { CLIConfig } from "../config.js";
import { ChildProcessOpRunner } from "../../core/op-runner.js";
import {
  OnePasswordKeyStore,
  createInOnePassword,
  readPrivateKeyHex,
} from "../../core/keystore-1password.js";

// --- Pure status model ---

export type KeyStoreStatusKind = "file" | "1password" | "none";

export type KeyStoreStatusState =
  | "ready"
  | "empty"
  | "configured"
  | "invalid"
  | "unreachable";

export interface ResolvedStatus {
  kind: KeyStoreStatusKind;
  state: KeyStoreStatusState;
  address?: Address;
  vaultId?: string;
  itemId?: string;
  configPath: string;
  reason?: string;
}

/**
 * Pure detection: figure out what the current config says about the
 * wallet backend, without making any external calls. This is the cheap
 * path that runs for `moneyos keystore status` by default — no biometric
 * prompts, no network, no op invocation.
 *
 * Precedence rules:
 *   - `keyStore.kind === "1password"` wins if configured at all (even if
 *     the legacy `privateKey` field is also present during a transitional
 *     state — enforcement of exclusivity lives at the command layer, not
 *     the config schema).
 *   - Otherwise, if `keyStore.kind === "file"` OR a legacy `privateKey`
 *     field is present, the backend is `file`.
 *   - Otherwise, no wallet is configured.
 */
export function resolveStatus(
  config: CLIConfig,
  configPath: string,
): ResolvedStatus {
  // 1Password backend — highest precedence.
  if (config.keyStore?.kind === "1password") {
    const { vaultId, itemId, address } = config.keyStore;
    if (!vaultId || !itemId) {
      return {
        kind: "1password",
        state: "invalid",
        address,
        vaultId,
        itemId,
        configPath,
        reason: "missing vaultId or itemId",
      };
    }
    return {
      kind: "1password",
      state: "configured",
      address,
      vaultId,
      itemId,
      configPath,
    };
  }

  // File backend — either the new `keyStore.kind === "file"` field OR a
  // legacy `privateKey` field in the root of the config.
  const hasFileKeyStore = config.keyStore?.kind === "file";
  const hasPrivateKey = Boolean(config.privateKey);

  if (hasFileKeyStore || hasPrivateKey) {
    if (!hasPrivateKey) {
      return {
        kind: "file",
        state: "empty",
        configPath,
      };
    }
    // Try to derive the address. If the hex is malformed, viem throws —
    // surface that as `invalid` with the viem error as the reason so the
    // user knows what went wrong.
    try {
      const account = privateKeyToAccount(config.privateKey!);
      return {
        kind: "file",
        state: "ready",
        address: account.address,
        configPath,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        kind: "file",
        state: "invalid",
        configPath,
        reason,
      };
    }
  }

  // Nothing configured.
  return {
    kind: "none",
    state: "empty",
    configPath,
  };
}

// --- Pure formatter ---

/**
 * Render a `ResolvedStatus` as the human-readable block `moneyos keystore
 * status` prints. Kept pure so it can be unit-tested without spinning up
 * commander.
 */
export function formatStatus(status: ResolvedStatus): string {
  const lines: string[] = [];

  if (status.kind === "none") {
    lines.push("Key store: (none)");
    lines.push(`Config:    ${status.configPath}`);
    lines.push("Status:    no wallet configured — run `moneyos init`");
    return lines.join("\n");
  }

  lines.push(`Key store: ${status.kind}`);

  if (status.address) {
    const suffix =
      status.kind === "1password"
        ? status.state === "ready"
          ? "  (verified via op read)"
          : "  (from local cache)"
        : "";
    lines.push(`Address:   ${status.address}${suffix}`);
  } else if (status.kind === "file") {
    lines.push("Address:   (none)");
  }

  if (status.kind === "1password") {
    if (status.vaultId) {
      lines.push(`Vault ID:  ${status.vaultId}`);
    }
    if (status.itemId) {
      lines.push(`Item ID:   ${status.itemId}`);
    }
  }

  lines.push(`Config:    ${status.configPath}`);

  let statusLine: string;
  switch (status.state) {
    case "ready":
      statusLine = "ready";
      break;
    case "empty":
      statusLine = "empty — run `moneyos init` to create a wallet";
      break;
    case "configured":
      statusLine = "configured (run with --live to verify)";
      break;
    case "invalid":
      statusLine = `invalid${status.reason ? ` — ${status.reason}` : ""}`;
      break;
    case "unreachable":
      statusLine = `unreachable${status.reason ? ` — ${status.reason}` : ""}`;
      break;
  }
  lines.push(`Status:    ${statusLine}`);

  return lines.join("\n");
}

// --- Live probe ---

/**
 * Opt-in liveness check for the 1Password backend: actually runs `op
 * read` via `OnePasswordKeyStore.loadSigner()`. This triggers the
 * biometric prompt on the user's Mac, which is why the default status
 * command does NOT call it.
 *
 * On success, upgrades the state to `ready`. On failure, downgrades to
 * `unreachable` with the underlying error message.
 */
async function probeOnePasswordLive(
  status: ResolvedStatus,
  opBinary?: string,
): Promise<ResolvedStatus> {
  if (status.kind !== "1password" || !status.vaultId || !status.itemId) {
    // Caller should have filtered; bail defensively without a probe.
    return status;
  }
  const runner = new ChildProcessOpRunner({ binary: opBinary });
  const store = new OnePasswordKeyStore({
    runner,
    vaultId: status.vaultId,
    itemId: status.itemId,
    address: status.address,
  });
  try {
    const signer = await store.loadSigner();
    return {
      ...status,
      state: "ready",
      // Surface the derived address if no local cache was set — free
      // usability win after a successful live probe.
      address: status.address ?? signer.address,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...status, state: "unreachable", reason };
  }
}

// --- Commander wiring ---

export const keystoreCommand = new Command("keystore").description(
  "Manage MoneyOS key storage backends",
);

keystoreCommand
  .command("status")
  .description("Show how the current wallet is stored")
  .option(
    "--live",
    "Verify the wallet is reachable (1Password: triggers biometric prompt)",
  )
  .option(
    "--op-binary <path>",
    "INTERNAL: path to the op CLI binary (for tests and smoke runs)",
  )
  .action(async (options) => {
    const config = loadFileConfig();
    const configPath = getConfigPath();
    let status = resolveStatus(config, configPath);

    // Only 1Password backends in a `configured` state benefit from a
    // live probe. File backends are already verified as part of
    // `resolveStatus` (address derivation); 1password/invalid and
    // 1password/unreachable would either skip the probe or fall through
    // to the same error report.
    if (
      options.live &&
      status.kind === "1password" &&
      status.state === "configured"
    ) {
      status = await probeOnePasswordLive(status, options.opBinary);
    }

    console.log(formatStatus(status));
  });

// --- Migration ---

export type MigrationTarget = "1password" | "file";

export type MigrationPreconditionResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Pure precondition check for `moneyos keystore migrate`. Uses the
 * already-resolved status (so the same precedence rules apply) to decide
 * whether the current config can be migrated to the requested target.
 *
 * Step 10 only implements `--to 1password`. `--to file` is step 11; until
 * it lands, this function returns a clear "not implemented yet" failure
 * for that target.
 */
export function validateMigrationPreconditions(
  status: ResolvedStatus,
  target: MigrationTarget,
): MigrationPreconditionResult {
  if (target === "1password") {
    switch (status.kind) {
      case "none":
        return {
          ok: false,
          reason: "no wallet configured — run `moneyos init` first",
        };
      case "1password":
        // Covers both 1password/configured and 1password/invalid: the
        // user is already on (or intended to be on) the 1password
        // backend, so migrating there is a no-op or a fix-up, not a
        // migration. If their 1p config is broken, they should fix it
        // (or re-run init) rather than re-running migrate.
        return {
          ok: false,
          reason: "already using the 1Password backend",
        };
      case "file":
        if (status.state === "ready") {
          return { ok: true };
        }
        if (status.state === "empty") {
          return {
            ok: false,
            reason: "file-backed config has no private key to migrate",
          };
        }
        if (status.state === "invalid") {
          return {
            ok: false,
            reason: `source private key is invalid: ${status.reason ?? "unknown"}`,
          };
        }
        return {
          ok: false,
          reason: `unexpected file-backend state: ${status.state}`,
        };
    }
  }

  // target === "file"
  switch (status.kind) {
    case "none":
      return {
        ok: false,
        reason: "no wallet configured — run `moneyos init` first",
      };
    case "file":
      // Even a file/empty or file/invalid config counts as "already on
      // file" for this check — the fix is to repair or re-init, not to
      // migrate to where you already are.
      return {
        ok: false,
        reason: "already using the file backend",
      };
    case "1password":
      if (status.state === "configured") {
        return { ok: true };
      }
      if (status.state === "invalid") {
        return {
          ok: false,
          reason: `source 1Password config is invalid: ${status.reason ?? "unknown"}`,
        };
      }
      return {
        ok: false,
        reason: `unexpected 1password-backend state: ${status.state}`,
      };
  }
}

export interface MigrationResult {
  vaultId: string;
  itemId: string;
  address: Address;
}

export interface BuildMigrationConfigOptions {
  /**
   * If true, leave the legacy `privateKey` field in the new config as a
   * transitional backup. Default false: the migration removes the
   * plaintext key from the local config, which is the whole point of
   * moving to 1Password.
   */
  keepFileCopy?: boolean;
}

/**
 * Pure helper: given the existing config and a successful migration
 * result, return the new `CLIConfig` object that should be written to
 * disk. Preserves `chainId` and `rpcUrl`, replaces any prior `keyStore`
 * descriptor wholesale, and drops the legacy `privateKey` unless
 * `keepFileCopy` is explicitly true.
 */
export function buildMigrationConfig(
  existing: CLIConfig,
  result: MigrationResult,
  options: BuildMigrationConfigOptions = {},
): CLIConfig {
  const { keepFileCopy = false } = options;

  const newConfig: CLIConfig = {
    chainId: existing.chainId,
    rpcUrl: existing.rpcUrl,
    keyStore: {
      kind: "1password",
      vaultId: result.vaultId,
      itemId: result.itemId,
      address: result.address,
    },
  };

  if (keepFileCopy && existing.privateKey) {
    newConfig.privateKey = existing.privateKey;
  }

  return newConfig;
}

/**
 * Pure helper for the reverse migration (`--to file`): given the existing
 * config and the private key just recovered from 1Password, return the
 * new `CLIConfig` that should be written to disk. Drops the `keyStore`
 * descriptor entirely — the whole point is to revert to the legacy
 * file-backed shape. Preserves `chainId` and `rpcUrl`. The incoming
 * `privateKey` parameter wins over any stale `existing.privateKey`
 * (which shouldn't be present in a clean 1password-backed config, but
 * might exist during a transitional state).
 */
export function buildReverseMigrationConfig(
  existing: CLIConfig,
  privateKey: Hex,
): CLIConfig {
  return {
    chainId: existing.chainId,
    rpcUrl: existing.rpcUrl,
    privateKey,
    // keyStore deliberately omitted — we're moving back to the legacy
    // file-backed shape.
  };
}

// --- Typed confirmation prompt (for --to file downgrades) ---

/**
 * Display a warning message and require the user to type exactly "yes"
 * to continue. Used to gate the `--to file` security downgrade. Bypass
 * via `--yes` lives in the action handler, not here.
 */
async function promptTypedConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(message);
    return answer.trim() === "yes";
  } finally {
    rl.close();
  }
}

keystoreCommand
  .command("migrate")
  .description("Move an existing wallet between key-store backends")
  .requiredOption("--to <kind>", "Target backend: 'file' or '1password'")
  .option(
    "--keep-file-copy",
    "[--to 1password only] leave the private key in the local config as a transitional backup (default: remove)",
  )
  .option(
    "--yes",
    "[--to file only] skip the typed confirmation prompt (for non-interactive use)",
  )
  .option(
    "--delete-1password-item",
    "[--to file only] delete the 1Password item after a successful migration (default: leave item in place)",
  )
  .option(
    "--op-binary <path>",
    "INTERNAL: path to the op CLI binary (for tests and smoke runs)",
  )
  .action(async (options) => {
    if (options.to !== "1password" && options.to !== "file") {
      console.error(
        `Invalid --to value: "${options.to}". Must be "file" or "1password".`,
      );
      process.exitCode = 1;
      return;
    }
    const target: MigrationTarget = options.to;

    const config = loadFileConfig();
    const configPath = getConfigPath();
    const status = resolveStatus(config, configPath);

    const preconditions = validateMigrationPreconditions(status, target);
    if (!preconditions.ok) {
      console.error(`Cannot migrate to ${target}: ${preconditions.reason}`);
      process.exitCode = 1;
      return;
    }

    const runner = new ChildProcessOpRunner({ binary: options.opBinary });

    if (target === "1password") {
      // --- Forward migration: file → 1Password ---

      // validateMigrationPreconditions guarantees status.kind === "file"
      // && status.state === "ready", which means config.privateKey is
      // present and yields status.address. The non-null assertions
      // below are safe under that invariant.
      const sourcePrivateKey = config.privateKey!;
      const sourceAddress = status.address!;

      let result: Awaited<ReturnType<typeof createInOnePassword>>;
      try {
        result = await createInOnePassword({
          runner,
          privateKey: sourcePrivateKey,
          chainId: config.chainId ?? 42161,
        });
      } catch (error) {
        console.error(
          error instanceof Error ? error.message : String(error),
        );
        process.exitCode = 1;
        return;
      }

      // Local invariant check. `createInOnePassword` derives its own
      // address from the same private key via viem, so this should
      // ALWAYS match. A mismatch would indicate something catastrophic
      // and we should refuse to rewrite the config.
      if (result.address !== sourceAddress) {
        console.error(
          `Address mismatch after creation: expected ${sourceAddress}, got ${result.address}. Config NOT rewritten.`,
        );
        process.exitCode = 1;
        return;
      }

      const newConfig = buildMigrationConfig(config, result, {
        keepFileCopy: options.keepFileCopy,
      });
      saveConfig(newConfig);

      console.log(`Migrated to 1Password.`);
      console.log(`Address:  ${result.address}`);
      console.log(`Vault ID: ${result.vaultId}`);
      console.log(`Item ID:  ${result.itemId}`);
      console.log(`Config:   ${configPath}`);
      if (options.keepFileCopy) {
        console.log(
          `\nThe private key remains in the local config as a transitional backup.`,
        );
      } else {
        console.log(
          `\nThe private key has been removed from the local config.`,
        );
      }
      console.log(
        `\nTo verify the migration is live: moneyos keystore status --live`,
      );
      return;
    }

    // --- Reverse migration: 1Password → file ---
    //
    // This is a SECURITY DOWNGRADE. The private key moves from a
    // concealed 1Password item to a plaintext field in the local config
    // file. The design doc requires explicit typed confirmation unless
    // the user passes --yes for non-interactive use.

    // validateMigrationPreconditions guarantees status.kind ===
    // "1password" && status.state === "configured", which means both
    // vaultId and itemId are present.
    const sourceVaultId = status.vaultId!;
    const sourceItemId = status.itemId!;

    if (!options.yes) {
      const warningLines = [
        "",
        "WARNING: This will write your private key in plaintext to:",
        `  ${configPath}`,
        "",
        options.delete1passwordItem
          ? "The 1Password item WILL BE DELETED after the config is written."
          : "The 1Password item will NOT be deleted unless --delete-1password-item is set.",
        "",
        'Type "yes" to continue: ',
      ];
      const confirmed = await promptTypedConfirmation(
        warningLines.join("\n"),
      );
      if (!confirmed) {
        console.log("Migration cancelled.");
        return;
      }
    }

    let privateKey: Hex;
    try {
      privateKey = await readPrivateKeyHex({
        runner,
        vaultId: sourceVaultId,
        itemId: sourceItemId,
      });
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }

    // Local invariant check: if a cached address was stored in the
    // local config, the key we just retrieved must derive to it. A
    // mismatch means the 1Password item may have been tampered with or
    // replaced, and we should refuse to rewrite the file.
    const derivedAddress = privateKeyToAccount(privateKey).address;
    if (status.address && derivedAddress !== status.address) {
      console.error(
        `Address mismatch: retrieved key derives to ${derivedAddress}, but stored metadata says ${status.address}. The 1Password item may have been tampered with. Config NOT rewritten.`,
      );
      process.exitCode = 1;
      return;
    }

    const newConfig = buildReverseMigrationConfig(config, privateKey);
    saveConfig(newConfig);

    console.log(`Migrated to file backend.`);
    console.log(`Address:  ${derivedAddress}`);
    console.log(`Config:   ${configPath}`);
    console.log(
      `\nThe private key is now stored in plaintext at ${configPath}.`,
    );

    if (options.delete1passwordItem) {
      // Opt-in cleanup. Migration itself has already succeeded at this
      // point — if deletion fails, we warn but do NOT roll back the
      // config or exit non-zero. The user can still use their wallet
      // via the file backend; the stale 1Password item is cosmetic.
      try {
        const deleteResult = await runner.run([
          "item",
          "delete",
          sourceItemId,
          "--vault",
          sourceVaultId,
        ]);
        if (deleteResult.exitCode !== 0) {
          const stderr =
            deleteResult.stderr.trim() || "(no stderr output)";
          console.warn(
            `\nWarning: failed to delete 1Password item (exit ${deleteResult.exitCode}): ${stderr}`,
          );
          console.warn(
            `The migration itself succeeded. To remove the stale item manually:`,
          );
          console.warn(
            `  op item delete ${sourceItemId} --vault ${sourceVaultId}`,
          );
        } else {
          console.log(`\n1Password item deleted.`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `\nWarning: failed to invoke op for item deletion: ${message}`,
        );
        console.warn(
          `The migration itself succeeded. To remove the stale item manually:`,
        );
        console.warn(
          `  op item delete ${sourceItemId} --vault ${sourceVaultId}`,
        );
      }
    } else {
      console.log(
        `\nThe 1Password item is still in place. To delete it manually:`,
      );
      console.log(
        `  op item delete ${sourceItemId} --vault ${sourceVaultId}`,
      );
    }
  });
