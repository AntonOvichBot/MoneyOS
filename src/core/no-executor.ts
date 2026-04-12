import type { ExecutionClient, ExecutionResult, CallRequest } from "@moneyos/core";

export const NO_SIGNING_ACCOUNT_ERROR =
  "No signing account configured. Set `signer`, `privateKey`, or `execute` in MoneyOS config.";

function throwNoSigningAccount(): never {
  throw new Error(NO_SIGNING_ACCOUNT_ERROR);
}

export function createNoExecutorClient(): ExecutionClient {
  return {
    mode: "eoa",
    getAddress(): never {
      return throwNoSigningAccount();
    },
    async send(_call: CallRequest): Promise<ExecutionResult> {
      return throwNoSigningAccount();
    },
    async sendBatch(_calls: CallRequest[]): Promise<ExecutionResult> {
      return throwNoSigningAccount();
    },
    capabilities() {
      return {
        sponsoredGas: false,
        batching: false,
        simulation: false,
      };
    },
  };
}
