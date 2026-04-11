import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { EOL } from "node:os";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { Address } from "viem";
import type { CallRequest, ExecutionClient, ExecutionResult } from "@moneyos/core";
import { EOAExecutor } from "../core/eoa.js";
import { privateKeyToManagedAccount } from "../core/signer.js";

export interface SessionServerStartMessage {
  type: "start";
  privateKey: `0x${string}`;
  chainId: number;
  rpcUrl?: string;
  socketPath: string;
  tokenPath: string;
  ttlMs: number;
}

export interface SessionStatusResult {
  address: Address;
  expiresAt: string;
}

export interface SessionServerHandle {
  readonly address: Address;
  readonly expiresAt: string;
  close(): Promise<void>;
}

interface SessionSendParams {
  to: Address;
  chainId: number;
  data?: `0x${string}`;
  value?: string;
}

type SessionRequest =
  | { id: string; token: string; type: "status" }
  | { id: string; token: string; type: "lock" }
  | { id: string; token: string; type: "send"; params: SessionSendParams };

type SessionRequestWithoutToken =
  | { id: string; type: "status" }
  | { id: string; type: "lock" }
  | { id: string; type: "send"; params: SessionSendParams };

type SessionResponse =
  | {
      id: string;
      ok: true;
      result: SessionStatusResult | ExecutionResult | { locked: true };
    }
  | { id: string; ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 750;
const MAX_MESSAGE_BYTES = 32 * 1024;
const SECURE_DIR_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;

function isWindowsPipe(path: string): boolean {
  return path.startsWith("\\\\.\\pipe\\");
}

function removeFileIfPresent(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

function ensureSecureParent(path: string): void {
  if (isWindowsPipe(path)) {
    return;
  }

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE });
    return;
  }

  const mode = statSync(dir).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `MoneyOS directory ${dir} has insecure permissions (${mode.toString(8)}). Restrict it to 700 before continuing.`,
    );
  }
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function loadSessionToken(tokenPath: string): string {
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    throw new Error("No active local MoneyOS session found.");
  }
}

function writeSecureToken(tokenPath: string, token: string): void {
  ensureSecureParent(tokenPath);
  writeFileSync(tokenPath, `${token}\n`, { mode: SECURE_FILE_MODE });
  chmodSync(tokenPath, SECURE_FILE_MODE);
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_MESSAGE_BYTES) {
        cleanup();
        reject(new Error("Session response exceeded the maximum allowed size."));
        return;
      }
      const index = buffer.indexOf("\n");
      if (index >= 0) {
        cleanup();
        resolve(buffer.slice(0, index));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Session daemon closed the connection unexpectedly."));
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function sendSessionRequest(
  socketPath: string,
  tokenPath: string,
  request: SessionRequestWithoutToken,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SessionResponse> {
  const fullRequest = {
    ...request,
    token: loadSessionToken(tokenPath),
  } as SessionRequest;
  const socket = net.createConnection(socketPath);

  return new Promise<SessionResponse>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error("Timed out waiting for local MoneyOS session."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
    };

    socket.once("connect", async () => {
      try {
        socket.write(`${JSON.stringify(fullRequest)}${EOL}`);
        const line = await readLine(socket);
        settled = true;
        cleanup();
        socket.end();
        resolve(JSON.parse(line) as SessionResponse);
      } catch (error) {
        settled = true;
        cleanup();
        socket.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

export async function getSessionStatus(
  socketPath: string,
  tokenPath: string,
): Promise<SessionStatusResult | undefined> {
  try {
    const response = await sendSessionRequest(
      socketPath,
      tokenPath,
      {
        id: createRequestId(),
        type: "status",
      },
      DEFAULT_TIMEOUT_MS,
    );
    return response.ok ? (response.result as SessionStatusResult) : undefined;
  } catch {
    removeFileIfPresent(socketPath);
    removeFileIfPresent(tokenPath);
    return undefined;
  }
}

export async function lockSession(
  socketPath: string,
  tokenPath: string,
): Promise<boolean> {
  try {
    const response = await sendSessionRequest(
      socketPath,
      tokenPath,
      {
        id: createRequestId(),
        type: "lock",
      },
      DEFAULT_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    removeFileIfPresent(socketPath);
    removeFileIfPresent(tokenPath);
    return false;
  }
}

export class SessionExecutionClient implements ExecutionClient {
  readonly mode = "eoa" as const;
  private readonly socketPath: string;
  private readonly tokenPath: string;
  private readonly address: Address;

  constructor(params: {
    socketPath: string;
    tokenPath: string;
    address: Address;
  }) {
    this.socketPath = params.socketPath;
    this.tokenPath = params.tokenPath;
    this.address = params.address;
  }

  getAddress(): Address {
    return this.address;
  }

  async send(call: CallRequest): Promise<ExecutionResult> {
    const response = await sendSessionRequest(
      this.socketPath,
      this.tokenPath,
      {
        id: createRequestId(),
        type: "send",
        params: {
          to: call.to,
          chainId: call.chainId,
          data: call.data,
          value: call.value?.toString(),
        },
      },
      DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error(response.error);
    }

    return response.result as ExecutionResult;
  }

  capabilities() {
    return {
      sponsoredGas: false,
      batching: false,
      simulation: false,
    };
  }
}

export async function startSessionServer(
  start: SessionServerStartMessage,
  hooks: {
    onError?: (error: Error) => void;
    onExit?: () => void;
  } = {},
): Promise<SessionServerHandle> {
  ensureSecureParent(start.tokenPath);
  ensureSecureParent(start.socketPath);
  removeFileIfPresent(start.socketPath);
  removeFileIfPresent(start.tokenPath);

  const signer = privateKeyToManagedAccount(start.privateKey);
  const executor = new EOAExecutor(signer, {
    defaultChainId: start.chainId,
    rpcUrl: start.rpcUrl,
  });
  const expiresAt = new Date(Date.now() + start.ttlMs);
  const token = randomBytes(32).toString("hex");
  writeSecureToken(start.tokenPath, token);

  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => {
        removeFileIfPresent(start.socketPath);
        removeFileIfPresent(start.tokenPath);
        hooks.onExit?.();
        resolve();
      });
    });
  };

  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_MESSAGE_BYTES) {
        socket.write(
          `${JSON.stringify({
            id: "unknown",
            ok: false,
            error: "Session request exceeded the maximum allowed size.",
          })}${EOL}`,
        );
        socket.end();
        return;
      }

      const index = buffer.indexOf("\n");
      if (index < 0) {
        return;
      }

      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let request: SessionRequest;
      try {
        request = JSON.parse(raw) as SessionRequest;
      } catch {
        socket.write(
          `${JSON.stringify({
            id: "unknown",
            ok: false,
            error: "Invalid session request.",
          })}${EOL}`,
        );
        socket.end();
        return;
      }

      const respond = (response: SessionResponse) => {
        socket.write(`${JSON.stringify(response)}${EOL}`);
        socket.end();
      };

      try {
        if (request.token !== token) {
          respond({
            id: request.id,
            ok: false,
            error: "Session authentication failed.",
          });
          return;
        }

        if (request.type === "status") {
          respond({
            id: request.id,
            ok: true,
            result: {
              address: executor.getAddress(),
              expiresAt: expiresAt.toISOString(),
            },
          });
          return;
        }

        if (request.type === "lock") {
          respond({
            id: request.id,
            ok: true,
            result: { locked: true },
          });
          setImmediate(() => {
            void close();
          });
          return;
        }

        const result = await executor.send({
          to: request.params.to,
          chainId: request.params.chainId,
          data: request.params.data,
          value:
            request.params.value !== undefined
              ? BigInt(request.params.value)
              : undefined,
        });

        respond({
          id: request.id,
          ok: true,
          result,
        });
      } catch (error) {
        respond({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => {
      hooks.onError?.(error instanceof Error ? error : new Error(String(error)));
      reject(error);
    });
    server.listen(start.socketPath, () => {
      if (!isWindowsPipe(start.socketPath)) {
        chmodSync(start.socketPath, SECURE_FILE_MODE);
      }
      resolve();
    });
  });

  const timer = setTimeout(() => {
    void close();
  }, start.ttlMs);
  timer.unref();

  return {
    address: executor.getAddress(),
    expiresAt: expiresAt.toISOString(),
    close,
  };
}

export async function startDetachedSessionDaemon(
  params: SessionServerStartMessage,
): Promise<SessionStatusResult> {
  const existing = await getSessionStatus(params.socketPath, params.tokenPath);
  if (existing) {
    await lockSession(params.socketPath, params.tokenPath);
  } else {
    removeFileIfPresent(params.socketPath);
    removeFileIfPresent(params.tokenPath);
  }

  return new Promise<SessionStatusResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], "__session-daemon"],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );

    let settled = false;

    const finish = (error?: Error, status?: SessionStatusResult) => {
      if (settled) return;
      settled = true;
      child.removeAllListeners();
      if (error) {
        reject(error);
        return;
      }
      resolve(status as SessionStatusResult);
    };

    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (!settled) {
        finish(
          new Error(
            `Session daemon exited unexpectedly with code ${code ?? "unknown"}.`,
          ),
        );
      }
    });
    child.on("message", (message: unknown) => {
      const payload = message as
        | { type: "ready"; address: Address; expiresAt: string }
        | { type: "error"; error: string };
      if (payload?.type === "ready") {
        child.disconnect();
        child.unref();
        finish(undefined, {
          address: payload.address,
          expiresAt: payload.expiresAt,
        });
      } else if (payload?.type === "error") {
        finish(new Error(payload.error));
      }
    });

    child.send(params);
  });
}

export async function runSessionDaemonProcess(): Promise<void> {
  if (!process.send) {
    throw new Error("Session daemon must be started through MoneyOS.");
  }

  const start = await new Promise<SessionServerStartMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Session daemon did not receive startup parameters."));
    }, 1000);

    process.once("message", (message: unknown) => {
      clearTimeout(timeout);
      const payload = message as SessionServerStartMessage;
      if (payload?.type !== "start") {
        reject(new Error("Session daemon received invalid startup message."));
        return;
      }
      resolve(payload);
    });
  });

  const shutdown = (code: number = 0) => {
    removeFileIfPresent(start.socketPath);
    removeFileIfPresent(start.tokenPath);
    process.exit(code);
  };

  const handle = await startSessionServer(start, {
    onError: (error) => {
      process.send?.({
        type: "error",
        error: error.message,
      });
      shutdown(1);
    },
    onExit: () => shutdown(),
  });

  process.send?.({
    type: "ready",
    address: handle.address,
    expiresAt: handle.expiresAt,
  });
  process.on("SIGTERM", () => {
    void handle.close().then(() => shutdown());
  });
  process.on("SIGINT", () => {
    void handle.close().then(() => shutdown());
  });
}
