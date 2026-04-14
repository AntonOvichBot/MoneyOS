import type { PolicyConfig, PolicyDecision, PolicyInput } from "./types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_SELECTOR = "0xa9059cbb";
const APPROVE_SELECTOR = "0x095ea7b3";
const UINT256_MAX = (1n << 256n) - 1n;

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function selectorOf(data: `0x${string}`): `0x${string}` {
  if (data.length < 10) {
    return "0x00000000";
  }

  return data.slice(0, 10) as `0x${string}`;
}

function dataByteLength(data: `0x${string}`): number {
  return Math.max(0, (data.length - 2) / 2);
}

function decodeApprove(data: `0x${string}`): { spender: string; amount: bigint } | null {
  if (selectorOf(data) !== APPROVE_SELECTOR) {
    return null;
  }

  if (dataByteLength(data) !== 68) {
    return null;
  }

  const payload = data.slice(10);
  const spenderWord = payload.slice(0, 64);
  const amountWord = payload.slice(64, 128);

  const spender = `0x${spenderWord.slice(24)}`;
  const amount = BigInt(`0x${amountWord}`);

  return { spender: normalizeAddress(spender), amount };
}

function isNativeSend(calls: PolicyInput["intent"]["calls"]): boolean {
  const call = calls[0]!;
  return calls.length === 1 && call.value > 0n && dataByteLength(call.data) === 0;
}

function isErc20Send(calls: PolicyInput["intent"]["calls"], tokenAllowlist: Set<string>): boolean {
  const call = calls[0]!;
  return (
    calls.length === 1 &&
    call.value === 0n &&
    tokenAllowlist.has(normalizeAddress(call.target)) &&
    selectorOf(call.data) === TRANSFER_SELECTOR &&
    dataByteLength(call.data) === 68
  );
}

function isNativeInSwap(
  calls: PolicyInput["intent"]["calls"],
  odosRouters: Set<string>,
  swapSelectors: Set<string>,
): boolean {
  const call = calls[0]!;
  return (
    calls.length === 1 &&
    call.value > 0n &&
    odosRouters.has(normalizeAddress(call.target)) &&
    swapSelectors.has(selectorOf(call.data))
  );
}

function isErc20InSwap(
  calls: PolicyInput["intent"]["calls"],
  tokenAllowlist: Set<string>,
  odosRouters: Set<string>,
  swapSelectors: Set<string>,
): boolean {
  if (calls.length !== 2) {
    return false;
  }

  const approve = calls[0]!;
  const swap = calls[1]!;

  if (approve.value !== 0n || swap.value !== 0n) {
    return false;
  }

  if (!tokenAllowlist.has(normalizeAddress(approve.target))) {
    return false;
  }

  if (!odosRouters.has(normalizeAddress(swap.target))) {
    return false;
  }

  if (selectorOf(approve.data) !== APPROVE_SELECTOR) {
    return false;
  }

  if (!swapSelectors.has(selectorOf(swap.data))) {
    return false;
  }

  const decodedApprove = decodeApprove(approve.data);
  if (!decodedApprove) {
    return false;
  }

  if (decodedApprove.spender !== normalizeAddress(swap.target)) {
    return false;
  }

  if (decodedApprove.amount === UINT256_MAX) {
    return false;
  }

  return true;
}

function fail(code: string, reason: string): PolicyDecision {
  return { ok: false, code, reason };
}

export function evaluateMoneyOSNativePolicy(
  input: PolicyInput,
  config: PolicyConfig,
): PolicyDecision {
  if (!input.relayHealthy) {
    return fail("relay_unhealthy", "Relay or RPC health gate failed.");
  }

  if (input.chainId !== config.chainId) {
    return fail("chain_not_supported", `Only chain ${config.chainId} is supported in v1.`);
  }

  const sponsor = normalizeAddress(input.intent.sponsor);
  const expectedSponsor = normalizeAddress(input.relayAddress || config.relayAddress);
  if (sponsor === ZERO_ADDRESS || sponsor !== expectedSponsor) {
    return fail("sponsor_mismatch", "Intent sponsor must match relay identity.");
  }

  const now = BigInt(input.nowSeconds);
  if (now < input.intent.validAfter) {
    return fail("intent_not_yet_valid", "Intent validAfter is in the future.");
  }

  if (input.intent.validUntil === 0n) {
    return fail(
      "window_too_long",
      `Intent window exceeds ${config.maxIntentWindowSeconds} seconds policy cap.`,
    );
  }

  if (input.intent.validUntil < input.intent.validAfter) {
    return fail("invalid_window", "validUntil must be greater than or equal to validAfter.");
  }

  if (now > input.intent.validUntil) {
    return fail("intent_expired", "Intent is outside its validity window.");
  }

  if (input.intent.validUntil - input.intent.validAfter > BigInt(config.maxIntentWindowSeconds)) {
    return fail(
      "window_too_long",
      `Intent window exceeds ${config.maxIntentWindowSeconds} seconds policy cap.`,
    );
  }

  const calls = input.intent.calls;
  if (calls.length === 0) {
    return fail("empty_calls", "Intent must include at least one call.");
  }

  const tokenAllowlist = new Set(config.tokenAllowlist.map(normalizeAddress));
  const odosRouters = new Set(config.odosRouters.map(normalizeAddress));
  const swapSelectors = new Set(config.odosSwapSelectors.map((selector) => selector.toLowerCase()));

  let flow: PolicyDecision["flow"];
  let reason: string;

  if (isNativeSend(calls)) {
    flow = "native-send";
    reason = "native send allowed";
  } else if (isErc20Send(calls, tokenAllowlist)) {
    flow = "erc20-send";
    reason = "erc20 send allowed";
  } else {
    const swapShape =
      isNativeInSwap(calls, odosRouters, swapSelectors) ||
      isErc20InSwap(calls, tokenAllowlist, odosRouters, swapSelectors);

    if (!swapShape) {
      return fail("shape_not_allowed", "Call batch does not match an allowed v1 send/swap shape.");
    }

    if (!input.route) {
      return fail("route_missing", "Swap sponsorship requires route freshness metadata.");
    }

    if (!input.route.providerId || !input.route.quotedAt) {
      return fail("route_metadata_incomplete", "Route metadata missing providerId or quotedAt.");
    }

    if (input.route.quoteId === undefined || input.route.quoteId.trim() === "") {
      return fail("quote_id_missing", "Swap submissions require provider quote identifier.");
    }

    if (input.nowSeconds - input.route.quotedAt > config.maxRouteAgeSeconds) {
      return fail("route_stale", "Provider quote age is outside freshness policy.");
    }

    if (input.route.expiresAt !== undefined && input.nowSeconds > input.route.expiresAt) {
      return fail("route_expired", "Provider quote expiry has passed.");
    }

    flow = calls.length === 1 ? "native-swap" : "erc20-swap";
    reason = calls.length === 1 ? "native-in swap allowed" : "erc20-in swap allowed";
  }

  if (!input.simulationPassed) {
    return fail("simulation_failed", "Execution simulation failed.");
  }

  if (!input.nonceReserved) {
    return fail("nonce_not_reserved", "Nonce reservation failed or missing.");
  }

  if (!input.treasuryAllowed || !input.walletAllowed) {
    return fail("treasury_or_wallet_limit", "Treasury or wallet caps rejected this intent.");
  }

  return {
    ok: true,
    code: "ok",
    reason,
    flow,
  };
}
