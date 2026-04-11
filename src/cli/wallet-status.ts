import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FileEncryptedWalletStore } from "../core/encrypted-wallet.js";
import {
  getLegacyPlaintextWalletStorageMessage,
  getRemovedOnePasswordCachedAddress,
  getRemovedOnePasswordStorageMessage,
  getWalletPath,
  hasLegacyPlaintextWalletConfig,
  hasRemovedOnePasswordConfig,
  type CLIConfig,
} from "./config.js";

export type WalletStatusKind =
  | "encrypted"
  | "none"
  | "legacy"
  | "unsupported"
  | "invalid";

export interface ResolvedWalletStatus {
  kind: WalletStatusKind;
  address?: Address;
  walletPath: string;
  reason?: string;
}

export async function resolveWalletStatus(
  config: CLIConfig,
  walletPath: string = getWalletPath(config),
): Promise<ResolvedWalletStatus> {
  if (hasRemovedOnePasswordConfig(config)) {
    return {
      kind: "unsupported",
      address: getRemovedOnePasswordCachedAddress(config),
      walletPath,
      reason: getRemovedOnePasswordStorageMessage(),
    };
  }

  const store = new FileEncryptedWalletStore(walletPath);
  if (store.exists()) {
    try {
      const metadata = await store.metadata();
      return {
        kind: metadata ? "encrypted" : "none",
        address: metadata?.address,
        walletPath,
      };
    } catch (error) {
      return {
        kind: "invalid",
        walletPath,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (hasLegacyPlaintextWalletConfig(config)) {
    try {
      const address = privateKeyToAccount(config.privateKey!).address;
      return {
        kind: "legacy",
        walletPath,
        address,
        reason: getLegacyPlaintextWalletStorageMessage(),
      };
    } catch (error) {
      return {
        kind: "legacy",
        walletPath,
        reason:
          error instanceof Error
            ? `${getLegacyPlaintextWalletStorageMessage()} (${error.message})`
            : getLegacyPlaintextWalletStorageMessage(),
      };
    }
  }

  return {
    kind: "none",
    walletPath,
  };
}

export function formatWalletStatus(status: ResolvedWalletStatus): string {
  const lines: string[] = [];

  if (status.kind === "none") {
    lines.push("Wallet:    (none)");
    lines.push(`Path:      ${status.walletPath}`);
    lines.push("Status:    no wallet configured — run `moneyos init`");
    return lines.join("\n");
  }

  if (status.kind === "unsupported") {
    lines.push("Wallet:    removed legacy model");
    if (status.address) {
      lines.push(`Address:   ${status.address}  (cached metadata)`);
    }
    lines.push(`Path:      ${status.walletPath}`);
    lines.push(
      `Status:    removed — ${status.reason ?? "unsupported legacy config"}`,
    );
    return lines.join("\n");
  }

  if (status.kind === "legacy") {
    lines.push("Wallet:    legacy plaintext config");
    if (status.address) {
      lines.push(`Address:   ${status.address}`);
    }
    lines.push(`Path:      ${status.walletPath}`);
    lines.push(
      `Status:    upgrade required — ${status.reason ?? 'run `moneyos init`'}`,
    );
    return lines.join("\n");
  }

  if (status.kind === "invalid") {
    lines.push("Wallet:    encrypted local wallet");
    lines.push(`Path:      ${status.walletPath}`);
    lines.push(`Status:    invalid — ${status.reason ?? "wallet file is unreadable"}`);
    return lines.join("\n");
  }

  lines.push("Wallet:    encrypted local wallet");
  if (status.address) {
    lines.push(`Address:   ${status.address}`);
  }
  lines.push(`Path:      ${status.walletPath}`);
  lines.push("Status:    ready");
  return lines.join("\n");
}
