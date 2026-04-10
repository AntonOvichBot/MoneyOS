// Particle's CJS build uses a getter-based __export pattern that Node's
// ESM → CJS named-export analysis does not detect. Using a default import
// with esModuleInterop pulls in the CJS module namespace — which IS the
// object that carries SmartAccount / AAWrapProvider / SendTransactionMode.
// Verified at runtime in Node 22 ESM.
import aaModule from "@particle-network/aa";
import type { AAWrapProvider as AAWrapProviderClass } from "@particle-network/aa";
const { SmartAccount, AAWrapProvider, SendTransactionMode } =
  aaModule as unknown as typeof import("@particle-network/aa");
import {
  createWalletClient,
  http,
  isAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import type {
  ExecutionClient,
  CallRequest,
  ExecutionResult,
} from "@moneyos/core";

/**
 * v1 is locked to Arbitrum One. Keeping this literal makes misuse a
 * compile-time error for TypeScript callers.
 */
const ARBITRUM_ONE_ID = 42161 as const;

export interface ParticleExecutorConfig {
  /** v1 only supports Arbitrum One (42161). */
  chainId: typeof ARBITRUM_ONE_ID;
  /** Optional RPC URL override for the owner wallet client. */
  rpcUrl?: string;
  /** Particle project ID. */
  projectId: string;
  /** Particle client key. */
  clientKey: string;
  /** Particle app ID. */
  appId: string;
  /** Owner EOA private key. Used only as the 4337 signer. */
  ownerPrivateKey: Hex;
  /**
   * Gas sponsorship mode. v1 defaults to "gasless" and rejects anything else.
   * Exposing the field now so the shape is stable when user-paid is added.
   */
  gasMode?: "gasless" | "user-paid-native";
  /**
   * Smart-account implementation. v1 locks to SIMPLE 2.0.0.
   */
  accountContract?: {
    name: "SIMPLE";
    version: "2.0.0";
  };
}

/**
 * Particle-backed smart-account ExecutionClient.
 *
 * - Identity is the smart-account address, not the owner EOA.
 * - `send()` routes through the Particle bundler with the paymaster enabled.
 * - Sponsorship failures throw — no silent fallback to user-paid gas.
 */
class ParticleExecutor implements ExecutionClient {
  readonly mode = "smart-account" as const;

  constructor(
    private readonly smartAccountAddress: Address,
    private readonly ownerAddress: Address,
    private readonly aaProvider: AAWrapProviderClass,
  ) {}

  getAddress(): Address {
    return this.smartAccountAddress;
  }

  /**
   * Particle-specific: returns the owner EOA that controls the smart account.
   * Not part of the ExecutionClient interface — accessible via an explicit
   * instanceof check or by calling this package's `getOwnerAddress(executor)`
   * helper.
   */
  getOwnerAddress(): Address {
    return this.ownerAddress;
  }

  async send(call: CallRequest): Promise<ExecutionResult> {
    if (call.chainId !== ARBITRUM_ONE_ID) {
      throw new Error(
        `ParticleExecutor v1 only supports Arbitrum One (${ARBITRUM_ONE_ID}), got chainId ${call.chainId}`,
      );
    }

    try {
      const hash = (await this.aaProvider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: this.smartAccountAddress,
            to: call.to,
            data: call.data ?? "0x",
            value: toHex(call.value ?? 0n),
          },
        ],
      })) as Hex;

      return { hash, chainId: call.chainId };
    } catch (error) {
      // Deliberately rethrow with context. Silent fallback would hide
      // gasless regressions.
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `ParticleExecutor.send failed (gasless sponsorship may have been declined): ${message}`,
        { cause: error },
      );
    }
  }

  capabilities() {
    return {
      sponsoredGas: true,
      batching: false,
      simulation: false,
    };
  }
}

/**
 * Build a minimal EIP-1193 provider around a viem wallet client. Particle's
 * `SmartAccount` only needs `request` in the Node.js flow; the event methods
 * on `IEthereumProvider` are wired as no-ops because the SDK does not emit
 * events to the owner provider in this path.
 */
function ownerProviderFromWalletClient(
  walletClient: ReturnType<typeof createWalletClient>,
  ownerAccount: ReturnType<typeof privateKeyToAccount>,
) {
  const provider = {
    async request(args: Partial<{ method: string; params?: unknown[] }>) {
      switch (args.method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [ownerAccount.address];
        case "personal_sign": {
          const [message, address] = (args.params ?? []) as
            | [Hex | string, Address?]
            | [];
          if (!message) {
            throw new Error("personal_sign requires a message");
          }
          if (
            address &&
            address.toLowerCase() !== ownerAccount.address.toLowerCase()
          ) {
            throw new Error(
              `personal_sign requested for ${address}, but owner provider controls ${ownerAccount.address}`,
            );
          }
          return ownerAccount.signMessage({
            message:
              typeof message === "string" && message.startsWith("0x")
                ? { raw: message as Hex }
                : message,
          });
        }
        default:
          return walletClient.request(args as never);
      }
    },
    on: () => provider,
    once: () => provider,
    off: () => provider,
    removeListener: () => provider,
  };
  return provider;
}

/**
 * Create a Particle-backed smart-account `ExecutionClient` for MoneyOS.
 *
 * The factory is async because Particle resolves the smart-account address
 * asynchronously. After this function resolves, the returned executor has a
 * stable sync `getAddress()` that satisfies the `ExecutionClient` contract.
 *
 * v1 locks (enforced at runtime):
 *   - Arbitrum One only
 *   - SIMPLE 2.0.0 smart-account contract
 *   - Gasless mode only
 *   - Owner is a local private key
 *   - No batching, no session keys, no social login
 *
 * Usage with MoneyOS:
 * ```ts
 *   const execute = await createParticleExecutor({
 *     chainId: 42161,
 *     projectId,
 *     clientKey,
 *     appId,
 *     ownerPrivateKey,
 *   });
 *   const moneyos = createMoneyOS({ chainId: 42161, execute });
 *   await moneyos.send("USDC", "0x...", "1"); // gasless
 * ```
 */
export async function createParticleExecutor(
  config: ParticleExecutorConfig,
): Promise<ExecutionClient> {
  // --- v1 lock guards ---
  if (config.chainId !== ARBITRUM_ONE_ID) {
    throw new Error(
      `createParticleExecutor v1 only supports Arbitrum One (${ARBITRUM_ONE_ID}), got chainId ${config.chainId}`,
    );
  }

  const gasMode = config.gasMode ?? "gasless";
  if (gasMode !== "gasless") {
    throw new Error(
      `createParticleExecutor v1 only supports gasMode: "gasless", got "${gasMode}"`,
    );
  }

  const accountContract = config.accountContract ?? {
    name: "SIMPLE" as const,
    version: "2.0.0" as const,
  };
  if (
    accountContract.name !== "SIMPLE" ||
    accountContract.version !== "2.0.0"
  ) {
    throw new Error(
      `createParticleExecutor v1 only supports SIMPLE 2.0.0, got ${accountContract.name} ${accountContract.version}`,
    );
  }

  // --- Owner: private key → viem wallet client → minimal EIP-1193 provider ---
  const ownerAccount = privateKeyToAccount(config.ownerPrivateKey);
  const ownerWalletClient = createWalletClient({
    account: ownerAccount,
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });
  const ownerEip1193 = ownerProviderFromWalletClient(
    ownerWalletClient,
    ownerAccount,
  );

  // --- SmartAccount ---
  const smartAccount = new SmartAccount(
    ownerEip1193 as never,
    {
      projectId: config.projectId,
      clientKey: config.clientKey,
      appId: config.appId,
      aaOptions: {
        accountContracts: {
          SIMPLE: [{ version: "2.0.0", chainIds: [ARBITRUM_ONE_ID] }],
        },
      },
    },
  );
  smartAccount.setSmartAccountContract({
    name: "SIMPLE",
    version: "2.0.0",
  });

  // --- Resolve the smart-account address (the async step that forced
  //     the factory shape). After this, getAddress() is sync. ---
  let smartAccountAddress: string;
  try {
    smartAccountAddress = await smartAccount.getAddress();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify(error)
          : String(error);
    throw new Error(
      `ParticleExecutor failed to derive the smart-account address: ${message}`,
      { cause: error },
    );
  }
  if (!isAddress(smartAccountAddress)) {
    throw new Error(
      `Particle SDK returned an invalid smart-account address: ${JSON.stringify(smartAccountAddress)}`,
    );
  }

  // --- AAWrapProvider in gasless mode.
  //     This is the EIP-1193 provider that handles eth_sendTransaction
  //     by building + sponsoring + submitting a UserOperation. ---
  const aaProvider = new AAWrapProvider(
    smartAccount,
    SendTransactionMode.Gasless,
  );

  return new ParticleExecutor(
    smartAccountAddress,
    ownerAccount.address,
    aaProvider,
  );
}

/**
 * Type guard + narrow accessor for the Particle-specific owner address.
 * Lets callers reach through `ExecutionClient` back to the owner EOA
 * without exposing vendor types on core.
 */
export function getOwnerAddress(executor: ExecutionClient): Address | undefined {
  if (executor instanceof ParticleExecutor) {
    return executor.getOwnerAddress();
  }
  return undefined;
}

// Exported for tests only. Not re-exported from the package index.
export { ParticleExecutor };
