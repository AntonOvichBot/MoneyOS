import { Command } from "commander";
import { getGaslessNetworkDefaults } from "@moneyos/gasless";
import {
  getConfigPath,
  getSessionSocketPath,
  getSessionTokenPath,
  loadFileConfig,
  saveConfig,
} from "../config.js";
import {
  gaslessEnvVarNames,
  getGaslessRequiredEnvPresence,
  isGaslessEnabled,
  resolveGaslessExecutionConfig,
} from "../gasless.js";
import { lockSession } from "../session.js";
import { loadCliAddress } from "../wallet.js";

function formatEnabled(enabled: boolean): string {
  return enabled ? "enabled" : "disabled";
}

async function refreshSessionAfterToggle(): Promise<void> {
  const locked = await lockSession(getSessionSocketPath(), getSessionTokenPath());
  if (locked) {
    console.log(
      "Active wallet session locked so the new gasless mode takes effect on next `moneyos auth unlock`.",
    );
    return;
  }

  console.log("No active wallet session was running.");
}

async function runGaslessToggle(enabled: boolean): Promise<void> {
  const config = loadFileConfig();
  const previous = config.gasless?.enabled === true;
  let nextGasless = {
    ...config.gasless,
    enabled,
  };

  if (enabled) {
    const ownerAddress = (await loadCliAddress(config)).address;
    const defaults = config.chainId
      ? getGaslessNetworkDefaults(config.chainId)
      : undefined;
    const enabledConfig = {
      ...config,
      gasless: {
        ...config.gasless,
        enabled: true,
      },
    };
    const derived = ownerAddress
      ? await resolveGaslessExecutionConfig(enabledConfig, {
          ownerAddress,
          chainId: config.chainId,
          rpcUrl: config.rpcUrl ?? defaults?.rpcUrl,
        })
      : undefined;

    nextGasless = {
      ...nextGasless,
      relayUrl: nextGasless.relayUrl ?? derived?.relayUrl ?? defaults?.relayUrl,
      sponsor: nextGasless.sponsor ?? derived?.sponsor ?? defaults?.sponsor,
      account: nextGasless.account ?? derived?.account,
    };
  }

  if (previous === enabled) {
    console.log(`Gasless is already ${formatEnabled(enabled)}.`);
  } else {
    console.log(`Gasless ${formatEnabled(enabled)} in ${getConfigPath()}.`);
  }

  saveConfig({
    ...config,
    gasless: nextGasless,
  });

  if (enabled) {
    const missing = Object.entries(getGaslessRequiredEnvPresence({
      ...config,
      gasless: nextGasless,
    }))
      .filter(([, present]) => !present)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.log(
        `Warning: gasless is enabled, but these values are still missing: ${missing.join(", ")}.`,
      );
    }
  }

  await refreshSessionAfterToggle();
}

async function runGaslessStatus(): Promise<void> {
  const config = loadFileConfig();
  const enabled = isGaslessEnabled(config);
  const envPresence = getGaslessRequiredEnvPresence(config);
  const missing = Object.entries(envPresence)
    .filter(([, present]) => !present)
    .map(([key]) => key);

  console.log(`Gasless: ${formatEnabled(enabled)}`);
  if (process.env[gaslessEnvVarNames.enabled] !== undefined) {
    console.log(`Mode source: ${gaslessEnvVarNames.enabled} environment override`);
  }

  console.log(
    `${gaslessEnvVarNames.relayUrl}: ${envPresence.relayUrl ? "set" : "missing"}`,
  );
  console.log(
    `${gaslessEnvVarNames.account}: ${envPresence.account ? "set" : "missing"}`,
  );
  console.log(
    `${gaslessEnvVarNames.sponsor}: ${envPresence.sponsor ? "set" : "missing"}`,
  );

  if (enabled && missing.length > 0) {
    console.log(
      `Gasless is enabled but not runnable until missing values are set: ${missing.join(", ")}.`,
    );
    process.exitCode = 1;
  }
}

export const gaslessCommand = new Command("gasless")
  .description("Inspect and toggle gasless execution mode")
  .addCommand(
    new Command("status")
      .description("Show whether gasless mode is enabled and whether required config is present")
      .action(async () => {
        await runGaslessStatus();
      }),
  )
  .addCommand(
    new Command("enable")
      .description("Enable gasless execution mode and persist chain defaults when available")
      .action(async () => {
        await runGaslessToggle(true);
      }),
  )
  .addCommand(
    new Command("disable")
      .description("Disable gasless execution mode and use the EOA executor")
      .action(async () => {
        await runGaslessToggle(false);
      }),
  );
