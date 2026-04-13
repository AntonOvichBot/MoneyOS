import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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
