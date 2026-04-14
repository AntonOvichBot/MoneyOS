import { Command } from "commander";
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
} from "../gasless.js";
import { lockSession } from "../session.js";

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

  if (previous === enabled) {
    console.log(`Gasless is already ${formatEnabled(enabled)}.`);
  } else {
    saveConfig(
      {
        ...config,
        gasless: {
          ...config.gasless,
          enabled,
        },
      },
    );
    console.log(
      `Gasless ${formatEnabled(enabled)} in ${getConfigPath()}.`,
    );
  }

  await refreshSessionAfterToggle();
}

async function runGaslessStatus(): Promise<void> {
  const config = loadFileConfig();
  const enabled = isGaslessEnabled(config);
  const envPresence = getGaslessRequiredEnvPresence();
  const missing = Object.entries(envPresence)
    .filter(([, present]) => !present)
    .map(([key]) => key);

  console.log(`Gasless: ${formatEnabled(enabled)}`);
  if (process.env[gaslessEnvVarNames.enabled] !== undefined) {
    console.log(`Mode source: ${gaslessEnvVarNames.enabled} environment override`);
  }

  console.log(
    `${gaslessEnvVarNames.relayUrl}: ${envPresence[gaslessEnvVarNames.relayUrl] ? "set" : "missing"}`,
  );
  console.log(
    `${gaslessEnvVarNames.account}: ${envPresence[gaslessEnvVarNames.account] ? "set" : "missing"}`,
  );
  console.log(
    `${gaslessEnvVarNames.sponsor}: ${envPresence[gaslessEnvVarNames.sponsor] ? "set" : "missing"}`,
  );

  if (enabled && missing.length > 0) {
    console.log(
      `Gasless is enabled but not runnable until missing env vars are set: ${missing.join(", ")}.`,
    );
    process.exitCode = 1;
  }
}

export const gaslessCommand = new Command("gasless")
  .description("Inspect and toggle gasless execution mode")
  .addCommand(
    new Command("status")
      .description("Show whether gasless mode is enabled and whether required env is present")
      .action(async () => {
        await runGaslessStatus();
      }),
  )
  .addCommand(
    new Command("enable")
      .description("Enable gasless execution mode (still requires gasless env config)")
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
