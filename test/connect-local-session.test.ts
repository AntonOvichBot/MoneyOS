import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  NATIVE_TOKEN_ADDRESS,
  getChain,
  getToken,
  getTokenAddress,
  type AssetRegistry,
  type CallRequest,
  type ExecutionClient,
  type ExecutionResult,
  type ReadClient,
} from "@moneyos/core";
import type { SwapProvider } from "@moneyos/swap";
import { executeSwap } from "@moneyos/swap";
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

  it("uses default session paths when no overrides are provided", async () => {
    // Calling with no options exercises the ?? default branches on lines 16-17.
    // No real daemon is running at the default path, so this throws.
    await expect(connectLocalSession()).rejects.toThrow(
      "No active local MoneyOS session found.",
    );
  });

  it(
    "executeSwap on a session-backed gasless daemon submits approve+swap as one atomic batch",
    async () => {
      // Regression: the CLI swap path goes through SessionExecutionClient,
      // not through the raw GaslessExecutor. The relay policy only sponsors
      // the atomic approve + swap batch shape, so the session transport must
      // actually forward sendBatch through to the daemon-side executor.
      const { baseDir, socketPath, tokenPath } = makeSessionPaths("swap-batch");
      const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
      const TX_HASH =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

      const receivedBatches: CallRequest[][] = [];
      let sendCalls = 0;
      const batchingExecutor: ExecutionClient = {
        mode: "smart-account",
        getAddress: () => TEST_ADDRESS,
        async send(): Promise<ExecutionResult> {
          sendCalls += 1;
          throw new Error("send should not be called on the gasless batch path");
        },
        async sendBatch(calls: CallRequest[]): Promise<ExecutionResult> {
          receivedBatches.push(calls);
          return { hash: TX_HASH, chainId: calls[0]!.chainId };
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
          ttlMs: 10_000,
        },
        { executor: batchingExecutor },
      );

      try {
        const execute = await connectLocalSession({ socketPath, tokenPath });
        expect(execute.capabilities().batching).toBe(true);

        const read: ReadClient = {
          getBalance: async () => 0n,
          readContract: async () => 0n as unknown as never,
        };
        const assets: AssetRegistry = {
          getToken,
          getTokenAddress,
          getChain,
          nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
        };
        const provider: SwapProvider = {
          name: "mock",
          getQuote: async () => ({
            tokenIn: getTokenAddress("USDC", 42161)!,
            tokenOut: NATIVE_TOKEN_ADDRESS,
            amountIn: "20000",
            expectedOut: "10000000000000000",
            chainId: 42161,
          }),
          getCalldata: async () => ({
            to: ROUTER,
            data: "0xdeadbeef",
            value: 0n,
          }),
        };

        const result = await executeSwap(
          {
            tokenIn: "USDC",
            tokenOut: "ETH",
            amount: "0.02",
            provider,
            chainId: 42161,
          },
          { read, execute, assets },
        );

        expect(result.hash).toBe(TX_HASH);
        expect(sendCalls).toBe(0);
        expect(receivedBatches).toHaveLength(1);
        const [batch] = receivedBatches;
        expect(batch).toHaveLength(2);
        expect(batch![0]!.to).toBe(getTokenAddress("USDC", 42161));
        expect(batch![0]!.data).toBeDefined();
        expect(batch![1]!.to).toBe(ROUTER);
        expect(batch![1]!.data).toBe("0xdeadbeef");
      } finally {
        await handle.close();
        rmSync(baseDir, { recursive: true, force: true });
      }
    },
  );
});
