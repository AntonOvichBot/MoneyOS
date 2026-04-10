/**
 * scripts/smoke-1password.ts
 *
 * End-to-end smoke test for the 1Password keystore CLI path.
 *
 * Drives the real `op` binary through the composed CLI flow:
 *   1. moneyos init --store 1password
 *   2. moneyos keystore status
 *   3. moneyos keystore status --live
 *   4. moneyos keystore migrate --to file --yes --delete-1password-item
 *   5. moneyos keystore status   (verify file backend)
 *
 * ⚠️  TOUCHES YOUR REAL ~/.moneyos/ DIR  ⚠️
 *
 * The script backs up any existing `~/.moneyos/config.json` before
 * starting and restores it in a `finally` block. Do NOT kill the
 * process mid-run (Ctrl-C after a phase has started) or the restore
 * step will be skipped and your real config will be left in a
 * migrated state. If that happens, look for a file named
 * `~/.moneyos/config.json.smoke-backup-<pid>` — that's your original.
 *
 * Prerequisites:
 *   - The `op` CLI must be installed and resolvable on PATH (or passed
 *     via MONEYOS_SMOKE_OP_BINARY).
 *   - 1Password desktop app integration must be enabled in the app's
 *     Developer settings.
 *   - You must be signed into at least one 1Password account in the
 *     desktop app.
 *   - You must have at least one vault where `op` can create items
 *     (the default "Private" vault works).
 *
 * Each phase will trigger a biometric prompt on your Mac. Expect at
 * least four prompts: one for `op item create` (init), one for
 * `op read` (status --live), one for `op read` (migrate), and one for
 * `op item delete` (migrate cleanup).
 *
 * Required env:
 *   MONEYOS_SMOKE_1PASSWORD=1        explicit safety switch — the
 *                                    script refuses to run without it
 *
 * Optional env:
 *   MONEYOS_SMOKE_OP_BINARY=<path>   path to the op binary (default: op
 *                                    on PATH)
 *   MONEYOS_SMOKE_SKIP_DELETE=1      skip the migrate-and-delete phase
 *                                    entirely, leaving the 1P item in
 *                                    place for manual inspection. The
 *                                    script still prints the vault/item
 *                                    IDs so you can delete it yourself.
 *
 * Exit codes:
 *   0  success (or SKIP_DELETE completed cleanly)
 *   1  runtime failure — a phase returned non-zero or threw
 *   2  missing required env or prerequisite
 */

import {
  readFileSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const CONFIG_DIR = join(homedir(), ".moneyos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const BACKUP_FILE = join(
  CONFIG_DIR,
  `config.json.smoke-backup-${process.pid}`,
);

// Track vault/item IDs across phases so the cleanup reporter can surface
// them on failure even if we never reached the migrate/delete phase.
let trackedVaultId: string | undefined;
let trackedItemId: string | undefined;
let itemDeletedByMigrate = false;

function banner(line: string): void {
  console.log(line);
}

function divider(): void {
  console.log("─".repeat(60));
}

function phaseHeader(n: number, label: string): void {
  console.log("");
  console.log(`[phase ${n}] ${label}`);
  divider();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Run the MoneyOS CLI in a subprocess via `npx tsx src/cli/index.ts`.
 * Each phase runs in a fresh process so commander state from one phase
 * cannot leak into the next. stdio is inherited so the user sees the
 * CLI output live.
 */
function runCli(args: string[]): number {
  const result = spawnSync(
    "npx",
    ["tsx", "src/cli/index.ts", ...args],
    {
      stdio: "inherit",
      encoding: "utf-8",
      cwd: process.cwd(),
    },
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn moneyos CLI: ${result.error.message}`,
      { cause: result.error },
    );
  }
  return result.status ?? 1;
}

function backupRealConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log(
      `  No existing ${CONFIG_FILE} — nothing to back up.`,
    );
    return;
  }
  if (existsSync(BACKUP_FILE)) {
    throw new Error(
      `Backup file already exists: ${BACKUP_FILE}. Refusing to overwrite.`,
    );
  }
  renameSync(CONFIG_FILE, BACKUP_FILE);
  console.log(`  Backed up ${CONFIG_FILE} → ${BACKUP_FILE}`);
}

function restoreRealConfig(): void {
  if (!existsSync(BACKUP_FILE)) {
    // No backup was made (no pre-existing config). Delete any smoke
    // config we created so we leave the dir in its original state.
    if (existsSync(CONFIG_FILE)) {
      try {
        unlinkSync(CONFIG_FILE);
        console.log(
          `  Cleaned up smoke config at ${CONFIG_FILE} (no backup to restore).`,
        );
      } catch (err) {
        console.error(
          `  Failed to clean up smoke config at ${CONFIG_FILE}: ${err}`,
        );
      }
    }
    return;
  }

  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
    renameSync(BACKUP_FILE, CONFIG_FILE);
    console.log(`  Restored ${BACKUP_FILE} → ${CONFIG_FILE}`);
  } catch (err) {
    console.error(
      `  Failed to restore real config: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      `  Manual recovery: mv "${BACKUP_FILE}" "${CONFIG_FILE}"`,
    );
  }
}

function reportOrphanedItem(opBinary: string | undefined): void {
  if (itemDeletedByMigrate) return;
  if (!trackedVaultId || !trackedItemId) return;

  const opCmd = opBinary ?? "op";
  console.error("");
  console.error(
    "⚠  A 1Password item may have been left behind by this smoke run.",
  );
  console.error(`   Vault ID: ${trackedVaultId}`);
  console.error(`   Item ID:  ${trackedItemId}`);
  console.error("");
  console.error("   To delete it manually:");
  console.error(
    `     ${opCmd} item delete ${trackedItemId} --vault ${trackedVaultId}`,
  );
}

async function main(): Promise<void> {
  banner("MoneyOS × 1Password — smoke test");
  banner("Driving the real `op` CLI through the composed keystore flow.");
  divider();

  // --- Prerequisites ---

  if (process.env.MONEYOS_SMOKE_1PASSWORD !== "1") {
    console.error(
      "This script touches your real ~/.moneyos/ directory and drives the",
    );
    console.error(
      "real `op` CLI against your real 1Password account. Re-run with:",
    );
    console.error("");
    console.error("    MONEYOS_SMOKE_1PASSWORD=1 npm run smoke:1password");
    console.error("");
    process.exit(2);
  }

  const opBinary = optional("MONEYOS_SMOKE_OP_BINARY");
  const skipDelete = process.env.MONEYOS_SMOKE_SKIP_DELETE === "1";

  if (opBinary) {
    console.log(`  op binary: ${opBinary}`);
  } else {
    console.log(`  op binary: op (PATH)`);
  }
  console.log(`  skip delete phase: ${skipDelete ? "yes" : "no"}`);

  // --- Phase 0: back up the real config ---

  phaseHeader(0, "Back up ~/.moneyos/config.json");
  backupRealConfig();

  // --- Phase 1: moneyos init --store 1password ---

  phaseHeader(1, "moneyos init --store 1password");
  console.log(
    "  (This will prompt 1Password to authorize creating a new item.)",
  );
  const initArgs = ["init", "--store", "1password"];
  if (opBinary) {
    initArgs.push("--op-binary", opBinary);
  }
  const initStatus = runCli(initArgs);
  if (initStatus !== 0) {
    throw new Error(`moneyos init exited with code ${initStatus}`);
  }

  // Read back the written config to track vault/item IDs for cleanup
  // reporting and sanity-check the shape.
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(
      `Post-init config not found at ${CONFIG_FILE} — init may have failed silently`,
    );
  }
  const writtenConfig = JSON.parse(
    readFileSync(CONFIG_FILE, "utf-8"),
  ) as {
    keyStore?: {
      kind?: string;
      vaultId?: string;
      itemId?: string;
      address?: string;
    };
    privateKey?: string;
  };
  if (writtenConfig.keyStore?.kind !== "1password") {
    throw new Error(
      `Post-init config does not have keyStore.kind === "1password" (got ${String(writtenConfig.keyStore?.kind)})`,
    );
  }
  if (!writtenConfig.keyStore.vaultId || !writtenConfig.keyStore.itemId) {
    throw new Error(
      "Post-init config is missing vaultId or itemId",
    );
  }
  if (writtenConfig.privateKey) {
    throw new Error(
      "Post-init config still contains a privateKey field — 1password path should not persist the key",
    );
  }
  trackedVaultId = writtenConfig.keyStore.vaultId;
  trackedItemId = writtenConfig.keyStore.itemId;
  console.log("");
  console.log(`  ✓ init wrote keyStore.kind=1password with:`);
  console.log(`      vaultId: ${trackedVaultId}`);
  console.log(`      itemId:  ${trackedItemId}`);
  console.log(`      address: ${writtenConfig.keyStore.address}`);
  console.log(`  ✓ privateKey was NOT written to the local config`);

  // --- Phase 2: moneyos keystore status (cheap) ---

  phaseHeader(2, "moneyos keystore status");
  console.log("  (Cheap probe — no biometric prompt.)");
  const statusCheapStatus = runCli(["keystore", "status"]);
  if (statusCheapStatus !== 0) {
    throw new Error(
      `moneyos keystore status exited with code ${statusCheapStatus}`,
    );
  }

  // --- Phase 3: moneyos keystore status --live ---

  phaseHeader(3, "moneyos keystore status --live");
  console.log(
    "  (This will prompt 1Password to authorize reading the item.)",
  );
  const statusLiveArgs = ["keystore", "status", "--live"];
  if (opBinary) {
    statusLiveArgs.push("--op-binary", opBinary);
  }
  const statusLiveStatus = runCli(statusLiveArgs);
  if (statusLiveStatus !== 0) {
    throw new Error(
      `moneyos keystore status --live exited with code ${statusLiveStatus}`,
    );
  }

  if (skipDelete) {
    console.log("");
    divider();
    console.log("MONEYOS_SMOKE_SKIP_DELETE=1 — stopping before migrate.");
    console.log(
      "The 1Password item will remain in place. Vault/item IDs:",
    );
    console.log(`  vaultId: ${trackedVaultId}`);
    console.log(`  itemId:  ${trackedItemId}`);
    console.log("");
    console.log(
      "The local config will still be restored to its original state.",
    );
    return;
  }

  // --- Phase 4: moneyos keystore migrate --to file --yes --delete-1password-item ---

  phaseHeader(
    4,
    "moneyos keystore migrate --to file --yes --delete-1password-item",
  );
  console.log(
    "  (This will prompt 1Password twice: once to read, once to delete.)",
  );
  const migrateArgs = [
    "keystore",
    "migrate",
    "--to",
    "file",
    "--yes",
    "--delete-1password-item",
  ];
  if (opBinary) {
    migrateArgs.push("--op-binary", opBinary);
  }
  const migrateStatus = runCli(migrateArgs);
  if (migrateStatus !== 0) {
    throw new Error(
      `moneyos keystore migrate exited with code ${migrateStatus}`,
    );
  }
  // If migrate succeeded, we asked it to delete the item.
  itemDeletedByMigrate = true;

  // Verify the config is now file-backed.
  const postMigrateConfig = JSON.parse(
    readFileSync(CONFIG_FILE, "utf-8"),
  ) as {
    keyStore?: unknown;
    privateKey?: string;
  };
  if (postMigrateConfig.keyStore !== undefined) {
    throw new Error(
      "Post-migrate config still has a keyStore field — should have been removed",
    );
  }
  if (!postMigrateConfig.privateKey) {
    throw new Error(
      "Post-migrate config is missing privateKey — reverse migration did not write the recovered key",
    );
  }
  console.log("");
  console.log(
    "  ✓ migrate wrote a file-backed config with privateKey at the root",
  );
  console.log("  ✓ keyStore descriptor has been removed");

  // --- Phase 5: moneyos keystore status (verify file backend) ---

  phaseHeader(5, "moneyos keystore status (verify file backend)");
  const statusAfterStatus = runCli(["keystore", "status"]);
  if (statusAfterStatus !== 0) {
    throw new Error(
      `moneyos keystore status (post-migrate) exited with code ${statusAfterStatus}`,
    );
  }

  console.log("");
  divider();
  console.log("✓ All phases passed.");
}

function printError(prefix: string, err: unknown, indent = "  "): void {
  if (err instanceof Error) {
    console.error(`${prefix}${err.message}`);
    if (err.stack) {
      for (const line of err.stack.split("\n").slice(1)) {
        console.error(`${indent}${line.trim()}`);
      }
    }
  } else {
    const text =
      typeof err === "object" && err !== null
        ? JSON.stringify(err, null, 2)
        : String(err);
    for (const line of text.split("\n")) {
      console.error(`${prefix}${line}`);
    }
  }
}

let exitCode = 0;

try {
  await main();
} catch (error: unknown) {
  exitCode = 1;
  console.error("");
  divider();
  console.error("✗ Smoke FAILED");
  divider();
  printError("", error);

  const cause =
    error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
  if (cause) {
    console.error("");
    console.error("Caused by:");
    printError("  ", cause);
  }
} finally {
  // Always attempt cleanup, in order:
  //   1. Restore the real ~/.moneyos/config.json from the backup.
  //   2. Report any orphaned 1Password item so the user can clean it up.
  console.log("");
  phaseHeader(99, "Cleanup");
  restoreRealConfig();
  reportOrphanedItem(optional("MONEYOS_SMOKE_OP_BINARY"));
}

process.exit(exitCode);
