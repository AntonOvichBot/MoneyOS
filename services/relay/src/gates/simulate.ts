import { moneyOSAccountFactoryV1Abi, moneyOSAccountV1Abi } from "@moneyos/gasless";
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
} from "viem";
import type { RuntimeConfig } from "../../config/runtime.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";
import { resolveSubmissionPath, type SubmissionPathClient } from "../submit/path.js";

export type SimulateResult =
  | { ok: true }
  | { ok: false; revertReason?: string; revertData?: `0x${string}` };

export interface SimulateGateOptions {
  runtime: RuntimeConfig;
  sponsorAddress: Address;
  publicClient: SubmissionPathClient & {
    simulateContract: any;
  };
}

function extractSimulationFailure(error: unknown): {
  revertReason?: string;
  revertData?: `0x${string}`;
} {
  const reverted =
    error instanceof ContractFunctionRevertedError
      ? error
      : error instanceof BaseError
        ? (error.walk(
            (candidate) => candidate instanceof ContractFunctionRevertedError,
          ) as ContractFunctionRevertedError | undefined)
        : undefined;

  const revertData =
    reverted && typeof (reverted as { raw?: unknown }).raw === "string"
      ? ((reverted as { raw: `0x${string}` }).raw)
      : reverted && typeof (reverted as { data?: unknown }).data === "string"
        ? ((reverted as { data: `0x${string}` }).data)
        : undefined;

  if (reverted) {
    return {
      revertReason: reverted.shortMessage,
      revertData,
    };
  }

  return {
    revertReason: error instanceof Error ? error.message : undefined,
  };
}

export function createSimulateGate(options: SimulateGateOptions) {
  return async (request: ExecuteIntentRequest): Promise<SimulateResult> => {
    try {
      const submissionPath = await resolveSubmissionPath(
        request,
        options.runtime,
        options.publicClient,
      );

      if (submissionPath.kind === "deploy-and-execute") {
        await options.publicClient.simulateContract({
          account: options.sponsorAddress,
          address: submissionPath.factoryAddress,
          abi: moneyOSAccountFactoryV1Abi,
          functionName: "deployAndExecute",
          args: [
            submissionPath.owner,
            submissionPath.salt,
            request.intent,
            request.signature,
          ],
          value: submissionPath.value,
        });

        return { ok: true };
      }

      await options.publicClient.simulateContract({
        account: options.sponsorAddress,
        address: request.intent.account as Address,
        abi: moneyOSAccountV1Abi,
        functionName: "execute",
        args: [request.intent, request.signature],
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        ...extractSimulationFailure(error),
      };
    }
  };
}
