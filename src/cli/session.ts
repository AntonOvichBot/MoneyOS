import { randomBytes, timingSafeEqual } from "node:crypto";
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
import type { GaslessExecutionConfig } from "../core/gasless.js";
import { createGaslessExecutionClient } from "../core/gasless.js";
import { EOAExecutor } from "../core/eoa.js";
import { privateKeyToManagedAccount } from "../core/signer.js";

export type SessionExecutionMode = ExecutionClient["mode"];

export type SessionExecutionCapabilities = ReturnType<
  ExecutionClient["capabilities"]
>;

export interface SessionGaslessStartConfig {
  account: Address;
  sponsor: Address;
  relayUrl: string;
  nonceKey?: string;
  validityWindowSeconds?: number;
}

export interface SessionServerStartMessage {
  type: "start";
  privateKey: `0x${string}`;
  chainId: number;
  rpcUrl?: string;
  socketPath: string;
  tokenPath: string;
  ttlMs: number;
  gasless?: SessionGaslessStartConfig;
}

export interface SessionStatusResult {
  address: Address;
  expiresAt: string;
  mode: SessionExecutionMode;
  capabilities: SessionExecutionCapabilities;
}

export interface SessionServerHandle {
  readonly address: Address;
  readonly expiresAt: string;
  readonly mode: SessionExecutionMode;
  readonly capabilities: SessionExecutionCapabilities;
  close(): Promise<void>;
}

interface SessionSendParams {
  to: Address;
  chainId: number;
  data?: `0x${string}`;
  value?: string;
}

interface SessionSendBatchParams {
  calls: SessionSendParams[];
}

type SessionRequest =
  | { id: string; token: string; type: "status" }
  | { id: string; token: string; type: "lock" }
  | { id: string; token: string; type: "send"; params: SessionSendParams }
  | {
      id: string;
      token: string;
      type: "sendBatch";
      params: SessionSendBatchParams;
    };

type SessionRequestWithoutToken =
  | { id: string; type: "status" }
  | { id: string; type: "lock" }
  | { id: string; type: "send"; params: SessionSendParams }
  | { id: string; type: "sendBatch"; params: SessionSendBatchParams };

type SessionResponse =
  | {
      id: string;
      ok: true;
      result: SessionStatusResult | ExecutionResult | { locked: true };
    }
  | { id: string; ok: false; error: string };

interface StoredSendResponse {
  fingerprint: string;
  response: Promise<SessionResponse>;
}

const SESSION_CONTROL_TIMEOUT_MS = 750;
// Intentionally much longer than control operations: on-chain submission does
// real RPC work, and PR #12 fixed a live timeout-after-broadcast bug here.
const SESSION_SEND_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_BYTES = 32 * 1024;
const SECURE_DIR_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;
const SERVER_SOCKET_TIMEOUT_MS = 5000;
const SESSION_SHUTDOWN_TIMEOUT_MS = 15000;

function shouldEnforcePosixPermissions(): boolean {
  // Windows ACLs do not map cleanly to Node's POSIX-style mode bits.
  return process.platform !== "win32";
}

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

  if (!shouldEnforcePosixPermissions()) {
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

function createSendRequestFingerprint(
  request: Extract<SessionRequest, { type: "send" | "sendBatch" }>,
): string {
  return JSON.stringify({ type: request.type, params: request.params });
}

function toGaslessExecutionConfig(
  config: SessionGaslessStartConfig,
): GaslessExecutionConfig {
  return {
    account: config.account,
    sponsor: config.sponsor,
    relayUrl: config.relayUrl,
    nonceKey:
      config.nonceKey !== undefined && config.nonceKey.trim() !== ""
        ? BigInt(config.nonceKey)
        : undefined,
    validityWindowSeconds: config.validityWindowSeconds,
  };
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
  if (shouldEnforcePosixPermissions()) {
    chmodSync(tokenPath, SECURE_FILE_MODE);
  }
}

function sessionFilesGone(socketPath: string, tokenPath: string): boolean {
  const tokenMissing = !existsSync(tokenPath);
  const socketMissing = isWindowsPipe(socketPath) ? true : !existsSync(socketPath);
  return tokenMissing && socketMissing;
}

async function waitForSessionShutdown(
  socketPath: string,
  tokenPath: string,
  timeoutMs: number = SESSION_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();
  while (!sessionFilesGone(socketPath, tokenPath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        "Timed out waiting for the previous MoneyOS session to shut down cleanly.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function tokensMatch(expectedToken: string, receivedToken: string): boolean {
  const expected = Buffer.from(expectedToken, "utf8");
  const received = Buffer.from(receivedToken, "utf8");
  return (
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
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
  timeoutMs: number = SESSION_CONTROL_TIMEOUT_MS,
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

function isRetryableSessionTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.message === "Session daemon closed the connection unexpectedly."
    || error.message === "Timed out waiting for local MoneyOS session."
  ) {
    return true;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ECONNRESET"
    || code === "EPIPE"
    || code === "ETIMEDOUT"
    || code === "ERR_STREAM_DESTROYED"
  );
}

function unwrapSessionSendResponse(response: SessionResponse): ExecutionResult {
  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.result as ExecutionResult;
}

function capabilitiesForMode(
  mode: SessionExecutionMode,
): SessionExecutionCapabilities {
  const smartAccount = mode === "smart-account";
  return {
    sponsoredGas: smartAccount,
    batching: false,
    simulation: smartAccount,
  };
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
      SESSION_CONTROL_TIMEOUT_MS,
    );
    if (!response.ok) {
      return undefined;
    }

    const result = response.result as Partial<SessionStatusResult> & {
      address: Address;
      expiresAt: string;
    };
    const mode = result.mode ?? "eoa";
    return {
      address: result.address,
      expiresAt: result.expiresAt,
      mode,
      capabilities: result.capabilities ?? capabilitiesForMode(mode),
    };
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
      SESSION_CONTROL_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    removeFileIfPresent(socketPath);
    removeFileIfPresent(tokenPath);
    return false;
  }
}

function serializeCallForSession(call: CallRequest): SessionSendParams {
  return {
    to: call.to,
    chainId: call.chainId,
    data: call.data,
    value: call.value?.toString(),
  };
}

export class SessionExecutionClient implements ExecutionClient {
  readonly mode: SessionExecutionMode;
  private readonly socketPath: string;
  private readonly tokenPath: string;
  private readonly address: Address;
  private readonly caps: SessionExecutionCapabilities;

  constructor(params: {
    socketPath: string;
    tokenPath: string;
    address: Address;
    mode?: SessionExecutionMode;
    capabilities?: SessionExecutionCapabilities;
  }) {
    this.socketPath = params.socketPath;
    this.tokenPath = params.tokenPath;
    this.address = params.address;
    this.mode = params.mode ?? "eoa";
    this.caps = params.capabilities ?? capabilitiesForMode(this.mode);
  }

  getAddress(): Address {
    return this.address;
  }

  async send(call: CallRequest): Promise<ExecutionResult> {
    const requestId = createRequestId();

    try {
      return await this.sendWithRequestId(requestId, call);
    } catch (error) {
      if (!isRetryableSessionTransportError(error)) {
        throw error;
      }

      return this.sendWithRequestId(requestId, call);
    }
  }

  async sendBatch(calls: CallRequest[]): Promise<ExecutionResult> {
    if (calls.length === 0) {
      throw new Error("sendBatch requires at least one call");
    }
    const requestId = createRequestId();

    try {
      return await this.sendBatchWithRequestId(requestId, calls);
    } catch (error) {
      if (!isRetryableSessionTransportError(error)) {
        throw error;
      }

      return this.sendBatchWithRequestId(requestId, calls);
    }
  }

  private async sendWithRequestId(
    requestId: string,
    call: CallRequest,
  ): Promise<ExecutionResult> {
    const response = await sendSessionRequest(
      this.socketPath,
      this.tokenPath,
      {
        id: requestId,
        type: "send",
        params: serializeCallForSession(call),
      },
      SESSION_SEND_TIMEOUT_MS,
    );
    return unwrapSessionSendResponse(response);
  }

  private async sendBatchWithRequestId(
    requestId: string,
    calls: CallRequest[],
  ): Promise<ExecutionResult> {
    const response = await sendSessionRequest(
      this.socketPath,
      this.tokenPath,
      {
        id: requestId,
        type: "sendBatch",
        params: {
          calls: calls.map(serializeCallForSession),
        },
      },
      SESSION_SEND_TIMEOUT_MS,
    );
    return unwrapSessionSendResponse(response);
  }

  capabilities(): SessionExecutionCapabilities {
    return { ...this.caps };
  }
}

function deserializeSessionCall(params: SessionSendParams): CallRequest {
  return {
    to: params.to,
    chainId: params.chainId,
    data: params.data,
    value: params.value !== undefined ? BigInt(params.value) : undefined,
  };
}

async function executeSendLikeRequest(
  executor: ExecutionClient,
  request: Extract<SessionRequest, { type: "send" | "sendBatch" }>,
): Promise<SessionResponse> {
  try {
    let result: ExecutionResult;
    if (request.type === "send") {
      result = await executor.send(deserializeSessionCall(request.params));
    } else {
      if (typeof executor.sendBatch !== "function") {
        return {
          id: request.id,
          ok: false,
          error: "Session executor does not support batched execution.",
        };
      }
      if (request.params.calls.length === 0) {
        return {
          id: request.id,
          ok: false,
          error: "sendBatch requires at least one call",
        };
      }
      result = await executor.sendBatch(
        request.params.calls.map(deserializeSessionCall),
      );
    }

    return {
      id: request.id,
      ok: true,
      result,
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startSessionServer(
  start: SessionServerStartMessage,
  hooks: {
    executor?: ExecutionClient;
    onError?: (error: Error) => void;
    onExit?: () => void;
  } = {},
): Promise<SessionServerHandle> {
  ensureSecureParent(start.tokenPath);
  ensureSecureParent(start.socketPath);
  removeFileIfPresent(start.socketPath);
  removeFileIfPresent(start.tokenPath);

  const signer = privateKeyToManagedAccount(start.privateKey);
  const executor = hooks.executor ?? (start.gasless
    ? createGaslessExecutionClient({
      signer,
      chainId: start.chainId,
      rpcUrl: start.rpcUrl,
      gasless: toGaslessExecutionConfig(start.gasless),
    })
    : new EOAExecutor(signer, {
      defaultChainId: start.chainId,
      rpcUrl: start.rpcUrl,
    }));
  const expiresAt = new Date(Date.now() + start.ttlMs);
  const token = randomBytes(32).toString("hex");
  // Retain send results for the session lifetime so a retry with the same
  // request ID never rebroadcasts after a late disconnect.
  const sendResponses = new Map<string, StoredSendResponse>();
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
    socket.setTimeout(SERVER_SOCKET_TIMEOUT_MS, () => {
      socket.destroy();
    });

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
        if (!tokensMatch(token, String(request.token ?? ""))) {
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
              mode: executor.mode,
              capabilities: executor.capabilities(),
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

        socket.setTimeout(SESSION_SEND_TIMEOUT_MS, () => {
          socket.destroy();
        });
        const fingerprint = createSendRequestFingerprint(request);
        const existing = sendResponses.get(request.id);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            respond({
              id: request.id,
              ok: false,
              error: "Session send request IDs cannot be reused with different parameters.",
            });
            return;
          }

          respond(await existing.response);
          return;
        }

        const responsePromise = executeSendLikeRequest(executor, request);
        sendResponses.set(request.id, {
          fingerprint,
          response: responsePromise,
        });

        respond(await responsePromise);
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
      if (
        shouldEnforcePosixPermissions()
        && !isWindowsPipe(start.socketPath)
      ) {
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
    mode: executor.mode,
    capabilities: executor.capabilities(),
    close,
  };
}

export async function startDetachedSessionDaemon(
  params: SessionServerStartMessage,
): Promise<SessionStatusResult> {
  const existing = await getSessionStatus(params.socketPath, params.tokenPath);
  if (existing) {
    const locked = await lockSession(params.socketPath, params.tokenPath);
    if (!locked && !sessionFilesGone(params.socketPath, params.tokenPath)) {
      throw new Error(
        "Failed to replace the existing MoneyOS session. Run `moneyos auth lock` and try again.",
      );
    }
    if (locked) {
      await waitForSessionShutdown(params.socketPath, params.tokenPath);
    }
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
        | {
            type: "ready";
            address: Address;
            expiresAt: string;
            mode: SessionExecutionMode;
            capabilities?: SessionExecutionCapabilities;
          }
        | { type: "error"; error: string };
      if (payload?.type === "ready") {
        child.disconnect();
        child.unref();
        finish(undefined, {
          address: payload.address,
          expiresAt: payload.expiresAt,
          mode: payload.mode,
          capabilities:
            payload.capabilities ?? capabilitiesForMode(payload.mode),
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
    mode: handle.mode,
    capabilities: handle.capabilities,
  });
  process.on("SIGTERM", () => {
    void handle.close().then(() => shutdown());
  });
  process.on("SIGINT", () => {
    void handle.close().then(() => shutdown());
  });
}
