import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
  connectLocalSession,
  createMoneyOS,
} from "../src/index.js";
import { startSessionServer } from "../src/cli/session.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;

function makeSessionPaths(prefix: string): {
  baseDir: string;
  socketPath: string;
  tokenPath: string;
} {
  const baseDir = mkdtempSync(join(tmpdir(), `moneyos-${prefix}-`));
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\moneyos-${prefix}-${Date.now()}`
      : join(baseDir, "session.sock");
  const tokenPath = join(baseDir, "session.token");
  return { baseDir, socketPath, tokenPath };
}

describe("connectLocalSession", () => {
  it("is exported from the root package and composes into MoneyOS runtime", async () => {
    expect(connectLocalSession).toBeTypeOf("function");

    const { baseDir, socketPath, tokenPath } = makeSessionPaths("compose");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 1000,
    });

    try {
      const execute = await connectLocalSession({
        socketPath,
        tokenPath,
      });
      const moneyos = createMoneyOS({
        chainId: 42161,
        execute,
      });

      expect(execute.getAddress()).toBe(TEST_ADDRESS);
      expect(moneyos.address).toBe(TEST_ADDRESS);
      expect(moneyos.runtime.execute.getAddress()).toBe(TEST_ADDRESS);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("sends successfully through the attached local session executor", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("send");
    const expectedResult: ExecutionResult = {
      hash: `0x${"2".repeat(64)}` as Hex,
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
      const execute = await connectLocalSession({
        socketPath,
        tokenPath,
      });

      await expect(
        execute.send({
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

  it("throws a clear unlock-required error when no active session exists", async () => {
    const { baseDir, socketPath, tokenPath } = makeSessionPaths("missing");

    try {
      await expect(
        connectLocalSession({
          socketPath,
          tokenPath,
        }),
      ).rejects.toThrow(
        "No active local MoneyOS session found. Run `moneyos auth unlock` locally first.",
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
