import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import { loadPolicyConfig, loadRuntimeConfig } from "../config/runtime.js";
import { buildRelayApp } from "./app.js";
import { RelayDatabase } from "./db/sqlite.js";
import { createRelayHealthyGate } from "./gates/relayHealthy.js";
import { createReserveNonceGate } from "./gates/reserveNonce.js";
import { createSimulateGate } from "./gates/simulate.js";
import { applyTreasuryUsage, createTreasuryGate } from "./gates/treasuryGate.js";
import { applyWalletUsage, createWalletGate } from "./gates/walletGate.js";
import { createSubmissionAdapter } from "./submit/adapter.js";

export async function startRelayServer() {
  const runtime = loadRuntimeConfig();
  const policy = loadPolicyConfig(runtime.policyPath, runtime);
  const db = new RelayDatabase(runtime.sqlitePath);
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const killSwitchEnabled = () => runtime.killSwitch;

  const chain = defineChain({
    id: runtime.chainId,
    name: "moneyos-relay",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [runtime.rpcUrl],
      },
    },
  });

  const healthClient = createPublicClient({
    chain,
    transport: http(runtime.rpcUrl),
  });

  const relayHealthy = createRelayHealthyGate({
    killSwitchEnabled,
    expectedChainId: runtime.chainId,
    client: {
      getChainId: async () => healthClient.getChainId(),
    },
  });

  const treasuryOptions = {
    db,
    rateLimit: runtime.rateLimit,
    nowSeconds,
    killSwitchEnabled,
  };

  const walletOptions = {
    db,
    rateLimit: runtime.rateLimit,
    nowSeconds,
    killSwitchEnabled,
  };

  const submissionAdapter = createSubmissionAdapter(runtime, db, {
    info: (message, payload) => console.info(message, payload ?? {}),
    warn: (message, payload) => console.warn(message, payload ?? {}),
    error: (message, payload) => console.error(message, payload ?? {}),
  });

  submissionAdapter.start();

  const app = buildRelayApp({
    policy,
    relayAddress: runtime.relayAddress,
    db,
    nowSeconds,
    reserveNonce: createReserveNonceGate(db, nowSeconds),
    simulate: createSimulateGate(),
    treasuryGate: createTreasuryGate(treasuryOptions),
    walletGate: createWalletGate(walletOptions),
    relayHealthy,
    submissionAdapter,
    onSubmissionAccepted: (request) => {
      applyTreasuryUsage(treasuryOptions);
      applyWalletUsage(walletOptions, request.intent.account);
    },
    logLevel: runtime.logLevel,
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  const stop = async () => {
    await app.close();
  };

  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });

  await app.listen({
    host: runtime.host,
    port: runtime.port,
  });

  app.log.info({ host: runtime.host, port: runtime.port }, "relay listening");
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  startRelayServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
