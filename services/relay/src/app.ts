import { intentIdempotencyKey } from "@moneyos/gasless";
import Fastify, { type FastifyInstance } from "fastify";
import type { PolicyInput } from "./policy/types.js";
import type { PolicyConfig } from "./policy/types.js";
import { relayCapabilities } from "./http/routes/capabilities.js";
import { evaluateExecuteIntent, type ExecuteIntentRequest } from "./http/routes/intents.js";
import type { RelayDatabase } from "./db/sqlite.js";
import type { SubmissionAdapter } from "./submit/adapter.js";

export interface RelayAppDependencies {
  policy: PolicyConfig;
  relayAddress: string;
  killSwitchEnabled: () => boolean;
  db: RelayDatabase;
  nowSeconds: () => number;
  reserveNonce: (intent: PolicyInput["intent"], idempotencyKey?: `0x${string}`) => Promise<boolean>;
  simulate: (input: ExecuteIntentRequest) => Promise<boolean>;
  treasuryGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  walletGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  relayHealthy: () => Promise<boolean>;
  submissionAdapter: Pick<SubmissionAdapter, "submitIntent" | "stop">;
  onSubmissionAccepted?: (input: ExecuteIntentRequest) => void;
  logLevel?: string;
}

function parseBigint(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new Error(`Invalid bigint field: ${field}`);
}

function parseAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address field: ${field}`);
  }

  return value as `0x${string}`;
}

function parseHex(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid hex field: ${field}`);
  }

  return value as `0x${string}`;
}

function parseExecuteIntentRequest(payload: unknown): ExecuteIntentRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Body must be an object");
  }

  const body = payload as Record<string, unknown>;
  if (!body.intent || typeof body.intent !== "object") {
    throw new Error("Missing intent object");
  }

  const intent = body.intent as Record<string, unknown>;
  const callsRaw = intent.calls;
  if (!Array.isArray(callsRaw)) {
    throw new Error("intent.calls must be an array");
  }

  const calls = callsRaw.map((call, index) => {
    if (!call || typeof call !== "object") {
      throw new Error(`intent.calls[${index}] must be an object`);
    }

    const typedCall = call as Record<string, unknown>;
    return {
      target: parseAddress(typedCall.target, `intent.calls[${index}].target`),
      value: parseBigint(typedCall.value, `intent.calls[${index}].value`),
      data: parseHex(typedCall.data, `intent.calls[${index}].data`),
    };
  });

  const routeRaw = body.route;
  let route: ExecuteIntentRequest["route"];
  if (routeRaw !== undefined) {
    if (!routeRaw || typeof routeRaw !== "object") {
      throw new Error("route must be an object");
    }

    const routeValue = routeRaw as Record<string, unknown>;
    if (typeof routeValue.providerId !== "string") {
      throw new Error("route.providerId must be a string");
    }

    const quotedAt = Number(routeValue.quotedAt);
    if (!Number.isFinite(quotedAt)) {
      throw new Error("route.quotedAt must be a finite number");
    }

    const expiresAt =
      routeValue.expiresAt === undefined ? undefined : Number(routeValue.expiresAt);

    if (expiresAt !== undefined && !Number.isFinite(expiresAt)) {
      throw new Error("route.expiresAt must be a finite number when provided");
    }

    route = {
      providerId: routeValue.providerId,
      quotedAt,
      expiresAt,
      quoteId:
        routeValue.quoteId === undefined ? undefined : String(routeValue.quoteId),
    };
  }

  return {
    intent: {
      account: parseAddress(intent.account, "intent.account"),
      sponsor: parseAddress(intent.sponsor, "intent.sponsor"),
      nonceKey: parseBigint(intent.nonceKey, "intent.nonceKey"),
      nonceSeq: parseBigint(intent.nonceSeq, "intent.nonceSeq"),
      validAfter: parseBigint(intent.validAfter, "intent.validAfter"),
      validUntil: parseBigint(intent.validUntil, "intent.validUntil"),
      calls,
    },
    signature: parseHex(body.signature, "signature"),
    route,
  };
}

function rejectionStatusCode(policyCode?: string): number {
  switch (policyCode) {
    case "relay_unhealthy":
      return 503;
    case "treasury_or_wallet_limit":
      return 429;
    case "nonce_not_reserved":
      return 409;
    default:
      return 422;
  }
}

export function buildRelayApp(deps: RelayAppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? "info",
    },
  });

  app.post("/v1/execute", async (request, reply) => {
    if (deps.killSwitchEnabled()) {
      reply.code(503);
      return {
        status: "rejected",
        code: "kill_switch_active",
        reason: "Relay kill switch is active.",
      };
    }

    let executeRequest: ExecuteIntentRequest;

    try {
      executeRequest = parseExecuteIntentRequest(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : "Invalid request",
      };
    }

    const replaySubmissionId = intentIdempotencyKey({
      account: executeRequest.intent.account as `0x${string}`,
      sponsor: executeRequest.intent.sponsor as `0x${string}`,
      nonceKey: executeRequest.intent.nonceKey,
      nonceSeq: executeRequest.intent.nonceSeq,
    });
    const replayExisting = deps.db.getSubmission(replaySubmissionId);

    if (
      replayExisting &&
      (replayExisting.status === "submitted" || replayExisting.status === "confirmed") &&
      replayExisting.txHash
    ) {
      return {
        submissionId: replayExisting.id,
        status: replayExisting.status,
        txHash: replayExisting.txHash,
      };
    }

    const decision = await evaluateExecuteIntent(executeRequest, {
      policy: deps.policy,
      relayAddress: deps.relayAddress,
      nowSeconds: deps.nowSeconds,
      reserveNonce: deps.reserveNonce,
      simulate: deps.simulate,
      treasuryGate: deps.treasuryGate,
      walletGate: deps.walletGate,
      relayHealthy: deps.relayHealthy,
    });

    if (decision.status === "rejected") {
      const priorSubmission = deps.db.getSubmission(decision.submissionId);
      const preservePriorSuccess =
        priorSubmission &&
        (priorSubmission.status === "submitted" || priorSubmission.status === "confirmed");

      if (!preservePriorSuccess) {
        deps.db.upsertSubmission(decision.submissionId, "rejected", deps.nowSeconds(), {
          reason: decision.reason ?? "Rejected by policy",
        });
      }

      reply.code(rejectionStatusCode(decision.policyCode));
      return {
        submissionId: decision.submissionId,
        status: "rejected",
        reason: decision.reason,
        policyCode: decision.policyCode,
      };
    }

    const existingSubmission = deps.db.getSubmission(decision.submissionId);
    if (
      existingSubmission &&
      (existingSubmission.status === "submitted" || existingSubmission.status === "confirmed") &&
      existingSubmission.txHash
    ) {
      return {
        submissionId: existingSubmission.id,
        status: existingSubmission.status,
        txHash: existingSubmission.txHash,
      };
    }

    try {
      const submission = await deps.submissionAdapter.submitIntent({
        submissionId: decision.submissionId,
        request: executeRequest,
      });

      deps.db.upsertSubmission(decision.submissionId, "submitted", deps.nowSeconds(), {
        txHash: submission.txHash,
      });

      deps.onSubmissionAccepted?.(executeRequest);

      return {
        submissionId: decision.submissionId,
        status: "submitted",
        txHash: submission.txHash,
      };
    } catch (error) {
      reply.code(502);
      return {
        submissionId: decision.submissionId,
        status: "failed",
        reason: error instanceof Error ? error.message : "Submission failed",
      };
    }
  });

  app.get("/v1/capabilities", async () => relayCapabilities(deps.policy));

  app.get("/v1/tx/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const submission = deps.db.getSubmission(params.id);

    if (!submission) {
      reply.code(404);
      return { error: "Submission not found" };
    }

    return {
      id: submission.id,
      status: submission.status,
      txHash: submission.txHash ?? undefined,
      reason: submission.reason ?? undefined,
    };
  });

  app.addHook("onClose", async () => {
    deps.submissionAdapter.stop();
  });

  return app;
}
