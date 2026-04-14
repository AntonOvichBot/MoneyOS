export interface RelayHealthClient {
  getChainId: () => Promise<number>;
}

export interface RelayHealthyGateOptions {
  killSwitchEnabled: () => boolean;
  expectedChainId: number;
  client: RelayHealthClient;
}

export function createRelayHealthyGate(options: RelayHealthyGateOptions) {
  return async (): Promise<boolean> => {
    if (options.killSwitchEnabled()) {
      return false;
    }

    try {
      const liveChainId = await options.client.getChainId();
      return liveChainId === options.expectedChainId;
    } catch {
      return false;
    }
  };
}
