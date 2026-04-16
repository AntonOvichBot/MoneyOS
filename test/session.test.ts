import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  CallRequest,
  ExecutionClient,
  ExecutionResult,
} from "@moneyos/core";
import {
  getSessionStatus,
  lockSession,
  SessionExecutionClient,
  startSessionServer,
} from "../src/cli/session.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;

interface RawSessionResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function makeSessionPaths(prefix: string): {
  baseDir: string;
  socketPath: string;
  tokenPath: string;
} {
  const baseDir = mkdtempSync(join(tmpdir(), "mos-"));
  const shortPrefix = prefix.slice(0, 8);
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\mos-${shortPrefix}-${Date.now()}`
      : join(baseDir, "s.sock");
  const tokenPath = join(baseDir, "t");
  return { baseDir, socketPath, tokenPath };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function readSocketLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
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

async function sendRawSessionRequest(
  socketPath: string,
  tokenPath: string,
  request: {
    id: string;
    type: "send";
    params: {
      to: Hex;
      chainId: number;
      data?: Hex;
      value?: string;
    };
  },
): Promise<RawSessionResponse> {
  const socket = net.createConnection(socketPath);
  const payload = {
    ...request,
    token: readFileSync(tokenPath, "utf8").trim(),
  };

  return new Promise((resolve, reject) => {
    socket.once("connect", async () => {
      try {
        socket.write(`${JSON.stringify(payload)}\n`);
        const line = await readSocketLine(socket);
        socket.end();
        resolve(JSON.parse(line) as RawSessionResponse);
      } catch (error) {
        socket.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.once("error", (error) => {
      reject(error);
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local auth session", () => {
  it("reports unlocked status and locks cleanly", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("status");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 5000,
    });

    try {
      expect(handle.address).toBe(TEST_ADDRESS);

      const status = await getSessionStatus(socketPath, tokenPath);
      expect(status?.address).toBe(TEST_ADDRESS);
      expect(status?.mode).toBe("eoa");

      const locked = await lockSession(socketPath, tokenPath);
      expect(locked).toBe(true);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }

    const statusAfter = await getSessionStatus(socketPath, tokenPath);
    expect(statusAfter).toBeUndefined();
  });

  it("expires automatically after the ttl", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("expiry");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 50,
    });

    expect(handle.address).toBe(TEST_ADDRESS);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const status = await getSessionStatus(socketPath, tokenPath);
    expect(status).toBeUndefined();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("reports smart-account mode when started in gasless mode", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("gasless-status");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 5000,
      gasless: {
        account: "0x1111111111111111111111111111111111111111",
        sponsor: "0x2222222222222222222222222222222222222222",
        relayUrl: "https://relay.moneyos.local",
      },
    });

    try {
      expect(handle.mode).toBe("smart-account");
      const status = await getSessionStatus(socketPath, tokenPath);
      expect(status?.mode).toBe("smart-account");
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("surfaces the daemon executor's capabilities through status and the client", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("caps");
    const batchingExecutor: ExecutionClient = {
      mode: "smart-account",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        return { hash: `0x${"a".repeat(64)}` as Hex, chainId: call.chainId };
      },
      async sendBatch(calls: CallRequest[]): Promise<ExecutionResult> {
        return { hash: `0x${"b".repeat(64)}` as Hex, chainId: calls[0]!.chainId };
      },
      capabilities() {
        return {
          sponsoredGas: true,
          batching: true,
          simulation: true,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      { executor: batchingExecutor },
    );

    try {
      const status = await getSessionStatus(socketPath, tokenPath);
      expect(status?.capabilities).toEqual({
        sponsoredGas: true,
        batching: true,
        simulation: true,
      });

      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
        mode: status!.mode,
        capabilities: status!.capabilities,
      });
      expect(client.capabilities()).toEqual({
        sponsoredGas: true,
        batching: true,
        simulation: true,
      });
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("forwards sendBatch to the daemon executor's sendBatch", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("batch");
    const receivedBatches: CallRequest[][] = [];
    const expectedResult: ExecutionResult = {
      hash: `0x${"c".repeat(64)}` as Hex,
      chainId: 42161,
    };
    const batchingExecutor: ExecutionClient = {
      mode: "smart-account",
      getAddress: () => TEST_ADDRESS,
      async send(): Promise<ExecutionResult> {
        throw new Error("send should not be called on the batch path");
      },
      async sendBatch(calls: CallRequest[]): Promise<ExecutionResult> {
        receivedBatches.push(calls);
        return { hash: expectedResult.hash, chainId: calls[0]!.chainId };
      },
      capabilities() {
        return {
          sponsoredGas: true,
          batching: true,
          simulation: true,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      { executor: batchingExecutor },
    );

    try {
      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
        mode: "smart-account",
        capabilities: {
          sponsoredGas: true,
          batching: true,
          simulation: true,
        },
      });

      const approveCall: CallRequest = {
        to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Hex,
        data: "0x095ea7b3" as Hex,
        chainId: 42161,
      };
      const swapCall: CallRequest = {
        to: "0x1111111111111111111111111111111111111111" as Hex,
        data: "0xdeadbeef" as Hex,
        value: 0n,
        chainId: 42161,
      };

      await expect(client.sendBatch([approveCall, swapCall])).resolves.toEqual(
        expectedResult,
      );

      expect(receivedBatches).toHaveLength(1);
      expect(receivedBatches[0]).toEqual([
        { ...approveCall, value: undefined },
        swapCall,
      ]);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns a clear error if sendBatch is requested from a non-batching daemon", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("nobatch");
    const eoaExecutor: ExecutionClient = {
      mode: "eoa",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        return { hash: `0x${"d".repeat(64)}` as Hex, chainId: call.chainId };
      },
      capabilities() {
        return {
          sponsoredGas: false,
          batching: false,
          simulation: false,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      { executor: eoaExecutor },
    );

    try {
      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
        mode: "eoa",
      });

      await expect(
        client.sendBatch([
          { to: TEST_ADDRESS, chainId: 42161 },
          { to: TEST_ADDRESS, chainId: 42161 },
        ]),
      ).rejects.toThrow("Session executor does not support batched execution.");
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps a slow send request alive long enough to return the executor result", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("send");
    const expectedResult: ExecutionResult = {
      hash: `0x${"1".repeat(64)}` as Hex,
      chainId: 42161,
    };
    const slowExecutor: ExecutionClient = {
      mode: "eoa",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return {
          hash: expectedResult.hash,
          chainId: call.chainId,
        };
      },
      capabilities() {
        return {
          sponsoredGas: false,
          batching: false,
          simulation: false,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      {
        executor: slowExecutor,
      },
    );

    try {
      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
      });

      await expect(
        client.send({
          to: TEST_ADDRESS,
          chainId: 42161,
          value: 0n,
        }),
      ).resolves.toEqual(expectedResult);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("retries a dropped send response once without rebroadcasting the transaction", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("retry");
    const sendStarted = createDeferred<void>();
    let sendCalls = 0;
    const expectedResult: ExecutionResult = {
      hash: `0x${"2".repeat(64)}` as Hex,
      chainId: 42161,
    };
    const executor: ExecutionClient = {
      mode: "eoa",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        sendCalls += 1;
        sendStarted.resolve();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          hash: expectedResult.hash,
          chainId: call.chainId,
        };
      },
      capabilities() {
        return {
          sponsoredGas: false,
          batching: false,
          simulation: false,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      {
        executor,
      },
    );

    const originalCreateConnection = net.createConnection.bind(net);
    let connectionCount = 0;
    vi.spyOn(net, "createConnection").mockImplementation(((...args: unknown[]) => {
      const socket = originalCreateConnection(...args as [string]);
      connectionCount += 1;

      if (connectionCount === 1) {
        const originalWrite = socket.write.bind(socket);
        let dropped = false;
        socket.write = ((...writeArgs: unknown[]) => {
          const result = originalWrite(...writeArgs as [string]);
          if (!dropped) {
            dropped = true;
            void sendStarted.promise.then(() => {
              socket.destroy();
            });
          }
          return result;
        }) as typeof socket.write;
      }

      return socket;
    }) as typeof net.createConnection);

    try {
      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
      });

      await expect(
        client.send({
          to: TEST_ADDRESS,
          chainId: 42161,
          value: 0n,
        }),
      ).resolves.toEqual(expectedResult);

      expect(sendCalls).toBe(1);
      expect(connectionCount).toBe(2);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("deduplicates duplicate send request ids while the first request is still in flight", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("idem");
    const release = createDeferred<void>();
    let sendCalls = 0;
    const executor: ExecutionClient = {
      mode: "eoa",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        sendCalls += 1;
        await release.promise;
        return {
          hash: `0x${"3".repeat(64)}` as Hex,
          chainId: call.chainId,
        };
      },
      capabilities() {
        return {
          sponsoredGas: false,
          batching: false,
          simulation: false,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      {
        executor,
      },
    );

    try {
      const request = {
        id: "send-idem-1",
        type: "send" as const,
        params: {
          to: TEST_ADDRESS,
          chainId: 42161,
          value: "0",
        },
      };
      const first = sendRawSessionRequest(socketPath, tokenPath, request);
      const second = sendRawSessionRequest(socketPath, tokenPath, request);
      release.resolve();

      await expect(Promise.all([first, second])).resolves.toEqual([
        {
          id: "send-idem-1",
          ok: true,
          result: {
            hash: `0x${"3".repeat(64)}`,
            chainId: 42161,
          },
        },
        {
          id: "send-idem-1",
          ok: true,
          result: {
            hash: `0x${"3".repeat(64)}`,
            chainId: 42161,
          },
        },
      ]);
      expect(sendCalls).toBe(1);
    } finally {
      release.resolve();
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("forwards per-request chain ids instead of pinning sends to the unlock-time chain", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("cross");
    const calls: CallRequest[] = [];
    const forwardingExecutor: ExecutionClient = {
      mode: "eoa",
      getAddress: () => TEST_ADDRESS,
      async send(call: CallRequest): Promise<ExecutionResult> {
        calls.push(call);
        return {
          hash: `0x${String(call.chainId).padStart(64, "0")}` as Hex,
          chainId: call.chainId,
        };
      },
      capabilities() {
        return {
          sponsoredGas: false,
          batching: false,
          simulation: false,
        };
      },
    };
    const handle = await startSessionServer(
      {
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      },
      {
        executor: forwardingExecutor,
      },
    );

    try {
      const client = new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: TEST_ADDRESS,
      });

      await expect(
        client.send({
          to: TEST_ADDRESS,
          chainId: 1,
          value: 0n,
        }),
      ).resolves.toEqual({
        hash: `0x${"1".padStart(64, "0")}` as Hex,
        chainId: 1,
      });

      await expect(
        client.send({
          to: TEST_ADDRESS,
          chainId: 137,
          value: 0n,
        }),
      ).resolves.toEqual({
        hash: `0x${"137".padStart(64, "0")}` as Hex,
        chainId: 137,
      });

      expect(calls).toEqual([
        {
          to: TEST_ADDRESS,
          chainId: 1,
          value: 0n,
        },
        {
          to: TEST_ADDRESS,
          chainId: 137,
          value: 0n,
        },
      ]);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("skips unix-only permission checks when the platform is win32", async () => {
    const originalPlatform = process.platform;
    const baseDir = mkdtempSync(join(tmpdir(), "mos-win32-"));
    const socketPath =
      originalPlatform === "win32"
        ? `\\\\.\\pipe\\mos-win32-${Date.now()}`
        : join(baseDir, "s.sock");
    const tokenPath = join(baseDir, "t");
    chmodSync(baseDir, 0o777);
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const handle = await startSessionServer({
        type: "start",
        privateKey: TEST_PK,
        chainId: 42161,
        socketPath,
        tokenPath,
        ttlMs: 5000,
      });

      try {
        expect(await getSessionStatus(socketPath, tokenPath)).toEqual(
          expect.objectContaining({ address: TEST_ADDRESS }),
        );
      } finally {
        await handle.close();
      }
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
