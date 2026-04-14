import { moneyOSAccountV1Abi } from "@moneyos/gasless";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { RuntimeConfig } from "../../config/runtime.js";
import type { RelayDatabase } from "../db/sqlite.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

export interface SubmitResult {
  txHash: `0x${string}`;
}

export interface SubmitIntentInput {
  submissionId: string;
  request: ExecuteIntentRequest;
}

export interface SubmissionLogger {
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
}

export interface SubmissionWalletClient {
  writeContract: (args: {
    address: `0x${string}`;
    abi: typeof moneyOSAccountV1Abi;
    functionName: "execute";
    args: [ExecuteIntentRequest["intent"], `0x${string}`];
  }) => Promise<`0x${string}`>;
}

export interface SubmissionPublicClient {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    gasUsed: bigint;
  }>;
}

export interface SubmissionAdapterOptions {
  db: RelayDatabase;
  walletClient: SubmissionWalletClient;
  publicClient: SubmissionPublicClient;
  pollIntervalMs: number;
  nowSeconds: () => number;
  logger: SubmissionLogger;
}

function isReceiptPendingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "TransactionReceiptNotFoundError" ||
    error.message.toLowerCase().includes("receipt")
  );
}

export class SubmissionAdapter {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SubmissionAdapterOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.pollPendingOnce();
    }, this.options.pollIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async submitIntent(input: SubmitIntentInput): Promise<SubmitResult> {
    const now = this.options.nowSeconds();
    this.options.db.upsertSubmission(input.submissionId, "pending", now);

    try {
      const txHash = await this.options.walletClient.writeContract({
        address: input.request.intent.account as `0x${string}`,
        abi: moneyOSAccountV1Abi,
        functionName: "execute",
        args: [input.request.intent, input.request.signature],
      });

      this.options.db.upsertSubmission(input.submissionId, "submitted", this.options.nowSeconds(), {
        txHash,
      });

      return { txHash };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Submission failed";
      this.options.db.upsertSubmission(input.submissionId, "failed", this.options.nowSeconds(), {
        reason,
      });
      throw error;
    }
  }

  async pollPendingOnce(): Promise<void> {
    const pending = this.options.db.listSubmitted();

    for (const submission of pending) {
      if (!submission.txHash) {
        continue;
      }

      try {
        const receipt = await this.options.publicClient.getTransactionReceipt({
          hash: submission.txHash,
        });

        if (receipt.status === "success") {
          this.options.db.upsertSubmission(
            submission.id,
            "confirmed",
            this.options.nowSeconds(),
            {
              confirmedAt: this.options.nowSeconds(),
              receiptBlockNumber: receipt.blockNumber,
              receiptGasUsed: receipt.gasUsed,
            },
          );
          this.options.logger.info("submission confirmed", {
            submissionId: submission.id,
            txHash: submission.txHash,
          });
          continue;
        }

        this.options.db.upsertSubmission(submission.id, "failed", this.options.nowSeconds(), {
          reason: "Transaction reverted",
        });
        this.options.logger.warn("submission reverted", {
          submissionId: submission.id,
          txHash: submission.txHash,
        });
      } catch (error) {
        if (isReceiptPendingError(error)) {
          continue;
        }

        this.options.logger.error("receipt poll failed", {
          submissionId: submission.id,
          txHash: submission.txHash,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export function createSubmissionAdapter(config: RuntimeConfig, db: RelayDatabase, logger: SubmissionLogger) {
  const chain = defineChain({
    id: config.chainId,
    name: "moneyos-relay",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
    },
  });

  const account = privateKeyToAccount(config.sponsorPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  }) as unknown as SubmissionWalletClient;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  }) as unknown as SubmissionPublicClient;

  return new SubmissionAdapter({
    db,
    walletClient,
    publicClient,
    pollIntervalMs: config.confirmPollMs,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    logger,
  });
}
