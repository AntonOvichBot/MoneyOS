import type { ExecutionClient } from "@moneyos/core";
import {
  getSessionSocketPath,
  getSessionTokenPath,
} from "./cli/config.js";
import { getSessionStatus, SessionExecutionClient } from "./cli/session.js";

export interface ConnectLocalSessionOptions {
  socketPath?: string;
  tokenPath?: string;
}

export async function connectLocalSession(
  options: ConnectLocalSessionOptions = {},
): Promise<ExecutionClient> {
  const socketPath = options.socketPath ?? getSessionSocketPath();
  const tokenPath = options.tokenPath ?? getSessionTokenPath();
  const session = await getSessionStatus(socketPath, tokenPath);

  if (!session) {
    throw new Error(
      "No active local MoneyOS session found. Run `moneyos auth unlock` locally first.",
    );
  }

  return new SessionExecutionClient({
    socketPath,
    tokenPath,
    address: session.address,
    mode: session.mode,
  });
}
