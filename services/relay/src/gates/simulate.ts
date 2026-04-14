import { moneyOSAccountFactoryV1Abi, moneyOSAccountV1Abi } from "@moneyos/gasless";
import type { Address } from "viem";
import type { RuntimeConfig } from "../../config/runtime.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";
import { resolveSubmissionPath, type SubmissionPathClient } from "../submit/path.js";

export interface SimulateGateOptions {
  runtime: RuntimeConfig;
  sponsorAddress: Address;
  publicClient: SubmissionPathClient & {
    simulateContract: any;
  };
}

export function createSimulateGate(options: SimulateGateOptions) {
  return async (request: ExecuteIntentRequest): Promise<boolean> => {
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

        return true;
      }

      await options.publicClient.simulateContract({
        account: options.sponsorAddress,
        address: request.intent.account as Address,
        abi: moneyOSAccountV1Abi,
        functionName: "execute",
        args: [request.intent, request.signature],
      });

      return true;
    } catch {
      return false;
    }
  };
}
