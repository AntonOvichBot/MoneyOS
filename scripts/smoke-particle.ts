/**
 * scripts/smoke-particle.ts
 *
 * Smoke test for @moneyos/executor-particle against Arbitrum One (mainnet).
 *
 * ⚠️  ARBITRUM MAINNET ONLY  ⚠️
 * ParticleExecutor v1 is hard-locked to chainId 42161. There is no testnet
 * path. This script WILL move real value on Arbitrum One unless you set
 * PARTICLE_SMOKE_SKIP_SEND=1 for a dry run that only derives addresses.
 *
 * Recommended first run:
 *   PARTICLE_SMOKE_SKIP_SEND=1 npm run smoke:particle
 * which validates credentials + smart-account derivation without sending.
 *
 * Then, once confirmed, run again with a TINY amount:
 *   PARTICLE_SMOKE_AMOUNT=0.00001 PARTICLE_SMOKE_TO=0xyour-test-addr \
 *     npm run smoke:particle
 *
 * The smart account (not the owner EOA) must hold the tokens being sent.
 * Gas is sponsored by the Particle paymaster — the owner EOA does not need
 * an ETH balance.
 *
 * Required env:
 *   PARTICLE_PROJECT_ID
 *   PARTICLE_CLIENT_KEY
 *   PARTICLE_APP_ID
 *   MONEYOS_PRIVATE_KEY         — owner EOA private key (hex, 0x-prefixed)
 *
 * Required unless PARTICLE_SMOKE_SKIP_SEND=1:
 *   PARTICLE_SMOKE_TO           — recipient address
 *   PARTICLE_SMOKE_AMOUNT       — amount as a decimal string (e.g. "0.00001")
 *
 * Optional:
 *   PARTICLE_SMOKE_TOKEN        — default "ETH"
 *   PARTICLE_SMOKE_SKIP_SEND    — "1" → stop after printing addresses
 *   MONEYOS_RPC_URL             — RPC override for the owner wallet client
 *
 * Exit codes:
 *   0  success (or SKIP_SEND dry run completed)
 *   1  smoke failure (executor creation, send, or any runtime error)
 *   2  missing required env
 */

import type { Address, Hex } from "viem";
import {
  createParticleExecutor,
  getOwnerAddress,
} from "@moneyos/executor-particle";
import { createMoneyOS } from "../src/index.js";

const ARBITRUM_ONE_ID = 42161 as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

function banner(line: string): void {
  console.log(line);
}

function divider(): void {
  console.log("─".repeat(60));
}

async function main(): Promise<void> {
  banner("MoneyOS × Particle — smoke test");
  banner("Chain: Arbitrum One (42161) — MAINNET");
  divider();

  const projectId = required("PARTICLE_PROJECT_ID");
  const clientKey = required("PARTICLE_CLIENT_KEY");
  const appId = required("PARTICLE_APP_ID");
  const ownerPrivateKey = required("MONEYOS_PRIVATE_KEY") as Hex;
  const rpcUrl = optional("MONEYOS_RPC_URL");

  const skipSend = process.env.PARTICLE_SMOKE_SKIP_SEND === "1";

  console.log("Creating Particle executor…");
  const execute = await createParticleExecutor({
    chainId: ARBITRUM_ONE_ID,
    projectId,
    clientKey,
    appId,
    ownerPrivateKey,
    rpcUrl,
  });

  const owner = getOwnerAddress(execute);
  const smartAccount = execute.getAddress();
  const caps = execute.capabilities();

  console.log(`  Owner EOA:       ${owner ?? "(unknown)"}`);
  console.log(`  Smart account:   ${smartAccount}`);
  console.log(`  Mode:            ${execute.mode}`);
  console.log(`  Sponsored gas:   ${caps.sponsoredGas}`);
  console.log(`  Batching:        ${caps.batching}`);
  divider();

  if (skipSend) {
    console.log("PARTICLE_SMOKE_SKIP_SEND=1 — stopping before send().");
    console.log("✓ Executor created and addresses derived. Credentials OK.");
    return;
  }

  const to = required("PARTICLE_SMOKE_TO") as Address;
  const token = optional("PARTICLE_SMOKE_TOKEN") ?? "ETH";
  const amount = required("PARTICLE_SMOKE_AMOUNT");

  console.log(`Preparing gasless send…`);
  console.log(`  Token:           ${token}`);
  console.log(`  Amount:          ${amount}`);
  console.log(`  To:              ${to}`);
  console.log(`  From (smart):    ${smartAccount}`);
  console.log(
    `  (Paymaster sponsors gas. Smart account must hold the ${token} being sent.)`,
  );
  divider();

  const moneyos = createMoneyOS({
    chainId: ARBITRUM_ONE_ID,
    execute,
  });

  console.log("Submitting user operation via Particle bundler…");
  const result = await moneyos.send(token, to, amount);

  divider();
  console.log("✓ Send succeeded.");
  console.log(`  Tx hash:  ${result.hash}`);
  console.log(`  Arbiscan: https://arbiscan.io/tx/${result.hash}`);
  console.log(`  From:     ${result.from}`);
  console.log(`  Token:    ${result.token}`);
  console.log(`  Amount:   ${result.amount}`);
}

function printError(prefix: string, err: unknown, indent = "  "): void {
  if (err instanceof Error) {
    console.error(`${prefix}${err.message}`);
    if (err.stack) {
      for (const line of err.stack.split("\n").slice(1)) {
        console.error(`${indent}${line.trim()}`);
      }
    }
  } else {
    const text =
      typeof err === "object" && err !== null
        ? JSON.stringify(err, null, 2)
        : String(err);
    for (const line of text.split("\n")) {
      console.error(`${prefix}${line}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error("");
  divider();
  console.error("✗ Smoke FAILED");
  divider();
  printError("", error);

  // ParticleExecutor wraps SDK errors and attaches the original as `.cause`.
  // Surfacing it is critical — that's where the real bundler/paymaster
  // error message lives.
  const cause =
    error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
  if (cause) {
    console.error("");
    console.error("Caused by:");
    printError("  ", cause);
  }
  process.exit(1);
});
