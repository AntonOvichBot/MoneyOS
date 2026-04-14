import { describe, expect, it, vi } from "vitest";
import { RelayDatabase } from "../db/sqlite.js";
import { SubmissionAdapter } from "./adapter.js";

describe("SubmissionAdapter", () => {
  it("submits intent and confirms via mocked receipt polling", async () => {
    const db = new RelayDatabase(":memory:");
    let now = 1710000000;

    const writeContract = vi.fn(async () => {
      return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
    });

    const getTransactionReceipt = vi.fn(async () => ({
      status: "success" as const,
      blockNumber: 12345n,
      gasUsed: 21000n,
    }));

    const adapter = new SubmissionAdapter({
      db,
      walletClient: { writeContract },
      publicClient: { getTransactionReceipt },
      pollIntervalMs: 10_000,
      nowSeconds: () => now,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await adapter.submitIntent({
      submissionId: "sub-1",
      request: {
        intent: {
          account: "0x1111111111111111111111111111111111111111",
          sponsor: "0x2222222222222222222222222222222222222222",
          nonceKey: 1n,
          nonceSeq: 2n,
          validAfter: 1710000000n,
          validUntil: 1710000300n,
          calls: [
            {
              target: "0x3333333333333333333333333333333333333333",
              value: 0n,
              data: "0x",
            },
          ],
        },
        signature: "0xdeadbeef",
      },
    });

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(db.getSubmission("sub-1")?.status).toBe("submitted");

    now += 6;
    await adapter.pollPendingOnce();

    const submission = db.getSubmission("sub-1");
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(submission?.status).toBe("confirmed");
    expect(submission?.receiptBlockNumber).toBe("12345");
    expect(submission?.receiptGasUsed).toBe("21000");

    db.close();
  });
});
