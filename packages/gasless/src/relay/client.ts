import type { Address, Hex } from "viem";
import type { IntentV1, RouteFreshnessMetadataV1 } from "../intent/v1-types.js";

export interface RelayCapabilities {
  policyVersion: string;
  chainId: number;
  supports: string[];
  sponsorAddress: Address;
}

export interface RelayExecuteRequestV1 {
  intent: IntentV1;
  signature: Hex;
  route: RouteFreshnessMetadataV1;
}

export interface RelayExecuteResponseV1 {
  submissionId: string;
  txHash?: Hex;
  status: "accepted" | "submitted" | "rejected";
  reason?: string;
  policyCode?: string;
  revertReason?: string;
}

export interface RelayTxStatusResponse {
  id: string;
  status: "pending" | "submitted" | "confirmed" | "failed" | "rejected";
  txHash?: Hex;
  reason?: string;
}

export interface RelayClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
}

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export class RelayClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.headers = {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    };
  }

  async execute(request: RelayExecuteRequestV1): Promise<RelayExecuteResponseV1> {
    return this.request<RelayExecuteResponseV1>("/v1/execute", {
      method: "POST",
      body: JSON.stringify(request, bigintJsonReplacer),
    });
  }

  async getTx(id: string): Promise<RelayTxStatusResponse> {
    return this.request<RelayTxStatusResponse>(`/v1/tx/${id}`, {
      method: "GET",
    });
  }

  async getCapabilities(): Promise<RelayCapabilities> {
    return this.request<RelayCapabilities>("/v1/capabilities", {
      method: "GET",
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Relay request failed (${res.status} ${res.statusText}) for ${path}: ${body}`,
      );
    }

    return (await res.json()) as T;
  }
}
