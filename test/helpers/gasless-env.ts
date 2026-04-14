import { afterEach, beforeEach } from "vitest";
import { gaslessEnvVarNames } from "../../src/cli/gasless.js";

const GASLESS_ENV_KEYS = Object.values(gaslessEnvVarNames);

export function installGaslessEnvIsolationHooks(extraKeys: readonly string[] = []) {
  const envKeys = [...new Set([...extraKeys, ...GASLESS_ENV_KEYS])];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

export function setDefaultGaslessEnv() {
  process.env[gaslessEnvVarNames.enabled] = "true";
  process.env[gaslessEnvVarNames.relayUrl] = "https://relay.moneyos.local";
  process.env[gaslessEnvVarNames.account] = "0x1111111111111111111111111111111111111111";
  process.env[gaslessEnvVarNames.sponsor] = "0x2222222222222222222222222222222222222222";
}
