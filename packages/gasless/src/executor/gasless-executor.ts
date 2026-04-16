import type {
  CallRequest,
  ExecutionClient,
  ExecutionResult,
} from "@moneyos/core";
import type { Address } from "viem";
import type { LocalAccount } from "viem/accounts";
import type { IntentCallV1, IntentV1, RouteFreshnessMetadataV1 } from "../intent/v1-types.js";
import { signIntentV1 } from "../intent/v1-sign.js";
import type { RelayClient, RelayExecuteResponseV1 } from "../relay/client.js";

export class GaslessRelayError extends Error {
  readonly submissionId: string;
  readonly status: RelayExecuteResponseV1["status"];
  readonly policyCode?: string;
  readonly revertReason?: string;
  readonly reason?: string;

  constructor(response: RelayExecuteResponseV1) {
    const detail =
      response.revertReason ??
      response.reason ??
      (response.status === "rejected"
        ? response.policyCode ?? "relay rejected the intent"
        : "relay accepted the intent without a transaction hash");
    const codeSuffix = response.policyCode ? ` [${response.policyCode}]` : "";
    super(`Gasless swap failed: ${detail}${codeSuffix}`);
    this.name = "GaslessRelayError";
    this.submissionId = response.submissionId;
    this.status = response.status;
    this.policyCode = response.policyCode;
    this.revertReason = response.revertReason;
    this.reason = response.reason;
  }
}

export interface NonceResolverInput {
  signer: Address;
  nonceKey: bigint;
}

export interface GaslessExecutorOptions {
  account: Address;
  sponsor: Address;
  chainId: number;
  signer: LocalAccount;
  relay: RelayClient;
  nonceResolver: (input: NonceResolverInput) => Promise<bigint>;
  nonceKey?: bigint;
  validityWindowSeconds?: number;
  clockSkewToleranceSeconds?: number;
}

export class GaslessExecutor implements ExecutionClient {
  readonly mode = "smart-account" as const;

  private readonly account: Address;
  private readonly sponsor: Address;
  private readonly chainId: number;
  private readonly signer: LocalAccount;
  private readonly relay: RelayClient;
  private readonly nonceResolver: (input: NonceResolverInput) => Promise<bigint>;
  private readonly nonceKey: bigint;
  private readonly validityWindowSeconds: number;
  private readonly clockSkewToleranceSeconds: number;

  constructor(options: GaslessExecutorOptions) {
    this.account = options.account;
    this.sponsor = options.sponsor;
    this.chainId = options.chainId;
    this.signer = options.signer;
    this.relay = options.relay;
    this.nonceResolver = options.nonceResolver;
    this.nonceKey = options.nonceKey ?? 0n;
    this.validityWindowSeconds = options.validityWindowSeconds ?? 300;
    this.clockSkewToleranceSeconds = options.clockSkewToleranceSeconds ?? 30;
  }

  getAddress(): Address {
    return this.account;
  }

  async send(call: CallRequest): Promise<ExecutionResult> {
    return this.sendBatch([call]);
  }

  async sendBatch(calls: CallRequest[]): Promise<ExecutionResult> {
    if (calls.length === 0) {
      throw new Error("sendBatch requires at least one call");
    }

    const chainId = calls[0]!.chainId;
    if (chainId !== this.chainId) {
      throw new Error(
        `Gasless executor configured for chain ${this.chainId} but received ${chainId}`,
      );
    }

    for (const call of calls) {
      if (call.chainId !== chainId) {
        throw new Error("All batched calls must share the same chainId");
      }
    }

    const nonceSeq = await this.nonceResolver({
      signer: this.signer.address,
      nonceKey: this.nonceKey,
    });

    const now = Math.floor(Date.now() / 1000);
    const validAfter = BigInt(
      Math.max(0, now - this.clockSkewToleranceSeconds),
    );
    const intent: IntentV1 = {
      account: this.account,
      sponsor: this.sponsor,
      nonceKey: this.nonceKey,
      nonceSeq,
      validAfter,
      validUntil: validAfter + BigInt(this.validityWindowSeconds),
      calls: calls.map(this.toIntentCall),
    };

    const signature = await signIntentV1(this.signer, intent, {
      chainId,
      verifyingContract: this.account,
    });

    const route: RouteFreshnessMetadataV1 = {
      providerId: "moneyos-native",
      quotedAt: now,
      expiresAt: now + this.validityWindowSeconds,
      quoteId: `native-${nonceSeq.toString()}`,
    };

    const response = await this.relay.execute({
      intent,
      signature,
      route,
    });

    if (response.status === "rejected" || !response.txHash) {
      throw new GaslessRelayError(response);
    }

    return {
      hash: response.txHash,
      chainId,
    };
  }

  capabilities() {
    return {
      sponsoredGas: true,
      batching: true,
      simulation: true,
    };
  }

  private readonly toIntentCall = (call: CallRequest): IntentCallV1 => ({
    target: call.to,
    value: call.value ?? 0n,
    data: call.data ?? "0x",
  });
}
