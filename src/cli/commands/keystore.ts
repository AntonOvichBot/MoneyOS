import { Command } from "commander";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  getConfigPath,
  getRemovedOnePasswordCachedAddress,
  getRemovedOnePasswordStorageMessage,
  hasRemovedOnePasswordConfig,
  loadFileConfig,
  type CLIConfig,
} from "../config.js";

export type KeyStoreStatusKind = "file" | "none" | "unsupported";

export type KeyStoreStatusState =
  | "ready"
  | "empty"
  | "invalid"
  | "removed";

export interface ResolvedStatus {
  kind: KeyStoreStatusKind;
  state: KeyStoreStatusState;
  address?: Address;
  configPath: string;
  reason?: string;
}

export function resolveStatus(
  config: CLIConfig,
  configPath: string,
): ResolvedStatus {
  if (hasRemovedOnePasswordConfig(config)) {
    return {
      kind: "unsupported",
      state: "removed",
      address: getRemovedOnePasswordCachedAddress(config),
      configPath,
      reason: getRemovedOnePasswordStorageMessage(),
    };
  }

  if (!config.privateKey) {
    return {
      kind: "none",
      state: "empty",
      configPath,
    };
  }

  try {
    const account = privateKeyToAccount(config.privateKey as Hex);
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

export function formatStatus(status: ResolvedStatus): string {
  const lines: string[] = [];

  if (status.kind === "none") {
    lines.push("Key store: (none)");
    lines.push(`Config:    ${status.configPath}`);
    lines.push("Status:    no wallet configured — run `moneyos init`");
    return lines.join("\n");
  }

  if (status.kind === "unsupported") {
    lines.push("Key store: removed legacy model");
    if (status.address) {
      lines.push(`Address:   ${status.address}  (cached metadata)`);
    }
    lines.push(`Config:    ${status.configPath}`);
    lines.push(
      `Status:    removed — ${status.reason ?? "unsupported legacy config"}`,
    );
    return lines.join("\n");
  }

  lines.push("Key store: file");

  if (status.address) {
    lines.push(`Address:   ${status.address}`);
  } else {
    lines.push("Address:   (none)");
  }

  lines.push(`Config:    ${status.configPath}`);
  lines.push(
    `Status:    ${
      status.state === "ready"
        ? "ready"
        : `invalid${status.reason ? ` — ${status.reason}` : ""}`
    }`,
  );

  return lines.join("\n");
}

export const keystoreCommand = new Command("keystore").description(
  "Inspect local wallet storage",
);

keystoreCommand
  .command("status")
  .description("Show how the current wallet is stored")
  .action(() => {
    const config = loadFileConfig();
    const status = resolveStatus(config, getConfigPath());
    console.log(formatStatus(status));
  });
