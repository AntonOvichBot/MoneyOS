import { describe, expect, it, vi } from "vitest";
import { RelayClient, type RelayExecuteRequestV1 } from "../src/relay/client.js";

describe("RelayClient", () => {
  it("serializes bigint request fields in execute body", async () => {
    let requestBody = "";

    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = (init?.body as string) ?? "";
      return new Response(
        JSON.stringify({
          submissionId: "sub-1",
          status: "accepted",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const client = new RelayClient({
      baseUrl: "https://relay.moneyos.test",
      fetchFn,
    });

    const request: RelayExecuteRequestV1 = {
      intent: {
        account: "0x1111111111111111111111111111111111111111",
        sponsor: "0x2222222222222222222222222222222222222222",
        nonceKey: 12n,
        nonceSeq: 34n,
        validAfter: 1710000000n,
        validUntil: 1710000300n,
        calls: [
          {
            target: "0x3333333333333333333333333333333333333333",
            value: 5n,
            data: "0x",
          },
        ],
      },
      signature: "0xdeadbeef",
      route: {
        providerId: "moneyos-native",
        quotedAt: 1710000000,
        quoteId: "q-1",
      },
    };

    await client.execute(request);

    const parsed = JSON.parse(requestBody) as {
      intent: {
        nonceKey: string;
        nonceSeq: string;
        validAfter: string;
        validUntil: string;
        calls: Array<{ value: string }>;
      };
    };

    expect(parsed.intent.nonceKey).toBe("12");
    expect(parsed.intent.nonceSeq).toBe("34");
    expect(parsed.intent.validAfter).toBe("1710000000");
    expect(parsed.intent.validUntil).toBe("1710000300");
    expect(parsed.intent.calls[0]!.value).toBe("5");
  });
});
