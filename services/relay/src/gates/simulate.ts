import type { ExecuteIntentRequest } from "../http/routes/intents.js";

function isHex(value: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(value);
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function createSimulateGate() {
  return async (request: ExecuteIntentRequest): Promise<boolean> => {
    if (request.intent.calls.length === 0) {
      return false;
    }

    return request.intent.calls.every((call) => {
      if (!isAddress(call.target)) {
        return false;
      }

      if (call.value < 0n) {
        return false;
      }

      return isHex(call.data);
    });
  };
}
