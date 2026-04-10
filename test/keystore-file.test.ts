import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FileKeyStore, createMoneyOS } from "../src/index.js";

describe("FileKeyStore", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-filekeystore-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("with no config file", () => {
    it("hasKey returns false", async () => {
      const store = new FileKeyStore({ configPath });
      expect(await store.hasKey()).toBe(false);
    });

    it("metadata returns { kind: 'file' } with no address", async () => {
      const store = new FileKeyStore({ configPath });
      const meta = await store.metadata();
      expect(meta.kind).toBe("file");
      expect(meta.address).toBeUndefined();
    });

    it("loadSigner throws with a helpful message", async () => {
      const store = new FileKeyStore({ configPath });
      await expect(store.loadSigner()).rejects.toThrow(
        /no private key found/,
      );
    });
  });

  describe("with a valid key in config", () => {
    const pk = generatePrivateKey();
    const expectedAddress = privateKeyToAccount(pk).address;

    beforeEach(() => {
      writeFileSync(
        configPath,
        JSON.stringify({ chainId: 42161, privateKey: pk }),
        { mode: 0o600 },
      );
    });

    it("hasKey returns true", async () => {
      const store = new FileKeyStore({ configPath });
      expect(await store.hasKey()).toBe(true);
    });

    it("metadata includes the derived address", async () => {
      const store = new FileKeyStore({ configPath });
      const meta = await store.metadata();
      expect(meta.kind).toBe("file");
      expect(meta.address).toBe(expectedAddress);
    });

    it("loadSigner returns a viem Account with the expected address", async () => {
      const store = new FileKeyStore({ configPath });
      const signer = await store.loadSigner();
      expect(signer.address).toBe(expectedAddress);
    });

    it("loaded signer matches privateKeyToAccount(pk) directly", async () => {
      const store = new FileKeyStore({ configPath });
      const signer = await store.loadSigner();
      const direct = privateKeyToAccount(pk);
      expect(signer.address).toBe(direct.address);
    });
  });

  describe("with extra fields in config", () => {
    it("ignores unrelated CLI config fields", async () => {
      const pk = generatePrivateKey();
      writeFileSync(
        configPath,
        JSON.stringify({
          chainId: 42161,
          rpcUrl: "https://arb1.arbitrum.io/rpc",
          privateKey: pk,
          futureField: "whatever",
        }),
      );
      const store = new FileKeyStore({ configPath });
      expect(await store.hasKey()).toBe(true);
      const signer = await store.loadSigner();
      expect(signer.address).toBe(privateKeyToAccount(pk).address);
    });

    it("treats a null privateKey as missing", async () => {
      writeFileSync(
        configPath,
        JSON.stringify({ chainId: 42161, privateKey: null }),
      );
      const store = new FileKeyStore({ configPath });
      expect(await store.hasKey()).toBe(false);
      const meta = await store.metadata();
      expect(meta.address).toBeUndefined();
    });
  });

  describe("with a malformed config file", () => {
    it("throws with context when the file is not JSON", async () => {
      writeFileSync(configPath, "not json at all {{{");
      const store = new FileKeyStore({ configPath });
      await expect(store.hasKey()).rejects.toThrow(
        /failed to read config/,
      );
    });

    it("throws when the top-level value is not an object", async () => {
      writeFileSync(configPath, JSON.stringify("just a string"));
      const store = new FileKeyStore({ configPath });
      await expect(store.hasKey()).rejects.toThrow(
        /not a JSON object/,
      );
    });

    it("throws when privateKey is present but not a string", async () => {
      writeFileSync(configPath, JSON.stringify({ privateKey: 12345 }));
      const store = new FileKeyStore({ configPath });
      await expect(store.hasKey()).rejects.toThrow(
        /privateKey.*must be a string/,
      );
    });
  });

  describe("integration with createMoneyOS", () => {
    it("FileKeyStore signer can construct a MoneyOS instance", async () => {
      const pk = generatePrivateKey();
      writeFileSync(
        configPath,
        JSON.stringify({ chainId: 42161, privateKey: pk }),
      );
      const store = new FileKeyStore({ configPath });
      const signer = await store.loadSigner();
      const m = createMoneyOS({ chainId: 42161, signer });
      expect(m.address).toBe(privateKeyToAccount(pk).address);
      expect(m.runtime.execute.mode).toBe("eoa");
    });
  });
});
