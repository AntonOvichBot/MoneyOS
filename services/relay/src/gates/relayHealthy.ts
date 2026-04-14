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
  onAutoRefillNeeded?: (payload: { balanceWei: bigint; thresholdWei: bigint }) => void;
}

export function createRelayHealthyGate(options: RelayHealthyGateOptions) {
  return async (): Promise<boolean> => {
    try {
      const liveChainId = await options.client.getChainId();
      if (liveChainId !== options.expectedChainId) {
        return false;
      }

      await options.client.getBlockNumber();

      const sponsorBalance = await options.client.getBalance({
        address: options.sponsorAddress,
      });

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
