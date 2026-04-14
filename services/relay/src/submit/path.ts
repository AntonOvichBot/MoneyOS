import {
  moneyOSAccountFactoryV1Abi,
  recoverIntentV1Signer,
  type IntentV1,
  type IntentV1Domain,
} from "@moneyos/gasless";
import type { Address, Hex } from "viem";
import type { RuntimeConfig } from "../../config/runtime.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

export interface SubmissionPathClient {
  getCode: (args: any) => Promise<Hex | undefined>;
  readContract: (args: any) => Promise<unknown>;
}

export type SubmissionPath =
  | {
      kind: "execute";
      value: bigint;
    }
  | {
      kind: "deploy-and-execute";
      factoryAddress: Address;
      owner: Address;
      salt: Hex;
      value: bigint;
    };

function sumCallValue(request: ExecuteIntentRequest): bigint {
  return request.intent.calls.reduce((total, call) => total + call.value, 0n);
}

function makeIntentDomain(request: ExecuteIntentRequest, chainId: number): IntentV1Domain {
  return {
    chainId,
    verifyingContract: request.intent.account as Address,
  };
}

export async function resolveSubmissionPath(
  request: ExecuteIntentRequest,
  runtime: RuntimeConfig,
  client: SubmissionPathClient,
): Promise<SubmissionPath> {
  const account = request.intent.account as Address;
  const code = await client.getCode({ address: account });
  const value = sumCallValue(request);

  if (code && code !== "0x") {
    return {
      kind: "execute",
      value,
    };
  }

  if (!runtime.accountFactoryAddress) {
    throw new Error(
      "Undeployed account submission requires MONEYOS_RELAY_ACCOUNT_FACTORY_ADDRESS to be configured.",
    );
  }

  const owner = await recoverIntentV1Signer(
    request.intent as IntentV1,
    request.signature,
    makeIntentDomain(request, runtime.chainId),
  );

  const predicted = (await client.readContract({
    address: runtime.accountFactoryAddress as Address,
    abi: moneyOSAccountFactoryV1Abi,
    functionName: "computeAccountAddress",
    args: [owner, runtime.accountFactorySalt as Hex],
  })) as Address;

  if (predicted.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Intent account does not match configured factory + owner + salt derivation.");
  }

  return {
    kind: "deploy-and-execute",
    factoryAddress: runtime.accountFactoryAddress as Address,
    owner,
    salt: runtime.accountFactorySalt as Hex,
    value,
  };
}
