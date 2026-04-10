import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AccessAdapter, AccessSession, SessionContext } from "@moneyos/core";

class LocalAccessSession implements AccessSession {
  readonly kind = "local" as const;
  private address: Address;

  constructor(privateKey: Hex) {
    this.address = privateKeyToAccount(privateKey).address;
  }

  getAddress(): Address {
    return this.address;
  }
}

export class LocalAccessAdapter implements AccessAdapter {
  readonly name = "local";
  private privateKey: Hex;

  constructor(privateKey: Hex) {
    this.privateKey = privateKey;
  }

  async openSession(_ctx: SessionContext): Promise<AccessSession> {
    return new LocalAccessSession(this.privateKey);
  }
}
