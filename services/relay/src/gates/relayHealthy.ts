import type { Address } from "viem";

export interface RelayHealthClient {
  getChainId: () => Promise<number>;
  getBlockNumber: () => Promise<bigint>;
  getBalance: (args: { address: Address }) => Promise<bigint>;
}

export interface RelayHealthyGateOptions {
  expectedChainId: number;
  sponsorAddress: Address;
  minimumSponsorBalanceWei: bigint;
  autoRefillThresholdWei: bigint;
  client: RelayHealthClient;
  timeoutMs?: number;
  onAutoRefillNeeded?: (payload: { balanceWei: bigint; thresholdWei: bigint }) => void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`relay health timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export function createRelayHealthyGate(options: RelayHealthyGateOptions) {
  return async (): Promise<boolean> => {
    try {
      const timeoutMs = options.timeoutMs ?? 2000;
      const liveChainId = await withTimeout(options.client.getChainId(), timeoutMs);
      if (liveChainId !== options.expectedChainId) {
        return false;
      }

      await withTimeout(options.client.getBlockNumber(), timeoutMs);

      const sponsorBalance = await withTimeout(options.client.getBalance({
        address: options.sponsorAddress,
      }), timeoutMs);

      if (sponsorBalance < options.minimumSponsorBalanceWei) {
        return false;
      }

      if (sponsorBalance < options.autoRefillThresholdWei) {
        options.onAutoRefillNeeded?.({
          balanceWei: sponsorBalance,
          thresholdWei: options.autoRefillThresholdWei,
        });
      }

      return true;
    } catch {
      return false;
    }
  };
}
