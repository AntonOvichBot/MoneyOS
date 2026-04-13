import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import type { MoneyOSCliContext, MoneyOSCliTool } from "../../cli-tool.js";
import { getToolHomeDir, getToolHomePackageJsonPath, getToolRegistryPath } from "../config.js";
import { createMoneyOSCliContext } from "./runtime.js";

const SUPPORTED_CLI_TOOL_VERSION = 1 as const;
const DEFAULT_RESERVED_ROOT_COMMANDS = new Set(["init", "auth", "backup", "balance", "send", "keystore", "add", "remove", "update", "tools", "help", "__session-daemon"]);
const FIRST_PARTY_TOOL_ALIASES: Record<string, string> = { swap: "@moneyos/swap" };
const VALID_COMMAND_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export interface ToolRegistryEntry {
  packageName: string;
  packageVersion: string;
  toolVersion: 1;
  name: string;
  commandPath: string[];
  description: string;
}

type ToolStatus = ToolRegistryEntry & { state: "ok" | "broken" | "conflict"; problems: string[] };
type Paths = { rootDir: string; packageJsonPath: string; registryPath: string };
type LoadedTool = ToolRegistryEntry & { createCommand: MoneyOSCliTool["createCommand"] };
type LoadedToolSource = {
  packageName: string;
  packageVersion: string;
  cliTool: unknown;
};
type SharedToolHomeDependencies = Record<string, string>;
type RootPackageMetadata = {
  dependencies?: Record<string, string>;
  moneyos?: {
    toolHomeDependencies?: Record<string, string>;
  };
};

export interface ToolUpdateResult {
  current: ToolRegistryEntry;
  next?: ToolRegistryEntry;
  state: "up-to-date" | "would-update" | "updated" | "skipped" | "failed";
  reason?: string;
}

class UnsupportedToolContractVersionError extends Error {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly actualVersion: number;
  readonly expectedVersion: number;

  constructor(
    packageName: string,
    packageVersion: string,
    actualVersion: number,
    expectedVersion: number = SUPPORTED_CLI_TOOL_VERSION,
  ) {
    super(
      `Package ${packageName}@${packageVersion} exports unsupported moneyosCliTool.version ${actualVersion}. Expected ${expectedVersion}.`,
    );
    this.name = "UnsupportedToolContractVersionError";
    this.packageName = packageName;
    this.packageVersion = packageVersion;
    this.actualVersion = actualVersion;
    this.expectedVersion = expectedVersion;
  }
}

const getPaths = (): Paths => ({
  rootDir: getToolHomeDir(),
  packageJsonPath: getToolHomePackageJsonPath(),
  registryPath: getToolRegistryPath(),
});

function findRootPackageJsonPath(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(currentDir, "package.json");
    if (existsSync(candidate)) {
      const packageJson = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
      if (packageJson.name === "moneyos") return candidate;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not find the root moneyos package.json.");
    }
    currentDir = parentDir;
  }
}

function getSharedToolHomeDependencies(): SharedToolHomeDependencies {
  const rootPackageJsonPath = findRootPackageJsonPath();
  const packageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as RootPackageMetadata;
  const coreVersion = packageJson.moneyos?.toolHomeDependencies?.["@moneyos/core"];
  const viemVersion = packageJson.dependencies?.viem;
  if (typeof coreVersion !== "string" || typeof viemVersion !== "string") {
    throw new Error(`Root package metadata at ${rootPackageJsonPath} is missing tool-home dependency versions.`);
  }
  return { "@moneyos/core": coreVersion, viem: viemVersion };
}

function collectReservedRootCommandNames(program: Command): Set<string> {
  return new Set([
    "help",
    ...program.commands.flatMap((command) => [command.name(), ...command.aliases()]),
  ]);
}

function ensureToolHome(paths: Paths, sharedToolHomeDependencies: SharedToolHomeDependencies): void {
  if (!existsSync(paths.rootDir)) mkdirSync(paths.rootDir, { recursive: true, mode: 0o700 });
  const exists = existsSync(paths.packageJsonPath);
  const parsed = exists
    ? JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as {
        name?: string;
        private?: boolean;
        description?: string;
        dependencies?: Record<string, string>;
      }
    : undefined;
  const packageJson = {
    name: parsed?.name ?? "moneyos-tools",
    private: parsed?.private ?? true,
    description: parsed?.description ?? "User-level installed MoneyOS CLI tools",
    dependencies: { ...(parsed?.dependencies ?? {}) },
  };
  let changed = !exists;
  for (const [name, version] of Object.entries(sharedToolHomeDependencies)) {
    if (packageJson.dependencies[name] !== version) {
      packageJson.dependencies[name] = version;
      changed = true;
    }
  }
  if (changed) writeFileSync(paths.packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o600 });
  if (!existsSync(paths.registryPath)) writeFileSync(paths.registryPath, "[]\n", { mode: 0o600 });
}

function parseRegistryEntry(value: unknown): ToolRegistryEntry {
  if (typeof value !== "object" || value === null) throw new Error("Invalid tool registry entry.");
  const entry = value as Partial<ToolRegistryEntry>;
  if (
    typeof entry.packageName !== "string"
    || typeof entry.packageVersion !== "string"
    || entry.toolVersion !== 1
    || typeof entry.name !== "string"
    || typeof entry.description !== "string"
    || !Array.isArray(entry.commandPath)
    || entry.commandPath.length === 0
    || entry.commandPath.some((segment) => typeof segment !== "string" || !VALID_COMMAND_SEGMENT.test(segment))
  ) throw new Error("Invalid tool registry entry.");
  return { packageName: entry.packageName, packageVersion: entry.packageVersion, toolVersion: 1, name: entry.name, commandPath: [...entry.commandPath], description: entry.description };
}

function parseLoadedTool(packageName: string, packageVersion: string, value: unknown): LoadedTool {
  if (typeof value !== "object" || value === null) throw new Error(`Package ${packageName} does not export \`moneyosCliTool\`.`);
  const tool = value as Partial<MoneyOSCliTool>;
  if (tool.version !== SUPPORTED_CLI_TOOL_VERSION) {
    if (typeof tool.version === "number") {
      throw new UnsupportedToolContractVersionError(
        packageName,
        packageVersion,
        tool.version,
      );
    }
    throw new Error(
      `Package ${packageName}@${packageVersion} exports an invalid \`moneyosCliTool\`.`,
    );
  }
  if (
    typeof tool.name !== "string"
    || typeof tool.description !== "string"
    || !Array.isArray(tool.commandPath)
    || tool.commandPath.length === 0
    || tool.commandPath.some((segment) => typeof segment !== "string" || !VALID_COMMAND_SEGMENT.test(segment))
    || typeof tool.createCommand !== "function"
  ) throw new Error(`Package ${packageName}@${packageVersion} exports an invalid \`moneyosCliTool\`.`);
  return {
    packageName,
    packageVersion,
    toolVersion: SUPPORTED_CLI_TOOL_VERSION,
    name: tool.name,
    commandPath: [...tool.commandPath],
    description: tool.description,
    createCommand: tool.createCommand,
  };
}

function getConflict(entry: ToolRegistryEntry, entries: ToolRegistryEntry[], reservedRootCommands: Set<string>): string | undefined {
  const path = entry.commandPath.join(" ");
  if (reservedRootCommands.has(entry.name) || reservedRootCommands.has(entry.commandPath[0])) {
    return `reserved root command collision for ${path}`;
  }
  for (const other of entries) {
    if (other.packageName === entry.packageName) continue;
    const otherPath = other.commandPath.join(" ");
    if (path === otherPath || path.startsWith(`${otherPath} `) || otherPath.startsWith(`${path} `)) {
      return `command path ${path} collides with installed tool path ${otherPath}`;
    }
  }
}

async function runNpm(paths: Paths, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", args, { cwd: paths.rootDir, stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `npm ${args[0]} failed with exit code ${String(code)}.`)));
  });
}

async function loadInstalledToolFromFsRaw(
  paths: Paths,
  packageName: string,
): Promise<LoadedToolSource> {
  const toolRequire = createRequire(paths.packageJsonPath);
  let entryPath: string;
  try {
    entryPath = toolRequire.resolve(packageName);
  } catch {
    throw new Error(`Package ${packageName} is missing from ${join(paths.rootDir, "node_modules")}.`);
  }
  for (let root = dirname(entryPath); root !== dirname(root); root = dirname(root)) {
    const packageJsonPath = join(root, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string; version?: string };
    if (packageJson.name === packageName && typeof packageJson.version === "string") {
      const moduleNamespace = await import(pathToFileURL(entryPath).href);
      return {
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        cliTool:
          (moduleNamespace as Record<string, unknown>).moneyosCliTool
          ?? ((moduleNamespace as Record<string, unknown>).default as Record<string, unknown> | undefined)?.moneyosCliTool,
      };
    }
  }
  throw new Error(`Could not find package.json for installed package ${packageName}.`);
}

async function loadInstalledToolFromFs(paths: Paths, packageName: string): Promise<LoadedTool> {
  const loaded = await loadInstalledToolFromFsRaw(paths, packageName);
  return parseLoadedTool(loaded.packageName, loaded.packageVersion, loaded.cliTool);
}

function toRegistryEntry(loaded: LoadedTool): ToolRegistryEntry {
  return {
    packageName: loaded.packageName,
    packageVersion: loaded.packageVersion,
    toolVersion: loaded.toolVersion,
    name: loaded.name,
    commandPath: loaded.commandPath,
    description: loaded.description,
  };
}

export function createCliToolManager(params: {
  paths?: Paths;
  packageManager?: {
    install(paths: Paths, spec: string): Promise<void>;
    uninstall(paths: Paths, packageName: string): Promise<void>;
    inspectLatest?(paths: Paths, packageName: string): Promise<LoadedToolSource>;
  };
  moduleLoader?: (paths: Paths, packageName: string) => Promise<LoadedToolSource>;
  cliContext?: MoneyOSCliContext;
  reservedRootCommands?: Iterable<string>;
  sharedToolHomeDependencies?: SharedToolHomeDependencies;
} = {}) {
  const paths = params.paths ?? getPaths();
  const cliContext = params.cliContext ?? createMoneyOSCliContext();
  const sharedToolHomeDependencies = params.sharedToolHomeDependencies ?? getSharedToolHomeDependencies();
  const sharedToolHomeDependencyNames = new Set(Object.keys(sharedToolHomeDependencies));
  let reservedRootCommands = new Set(params.reservedRootCommands ?? DEFAULT_RESERVED_ROOT_COMMANDS);
  const install = params.packageManager?.install ?? ((toolPaths: Paths, spec: string) => runNpm(toolPaths, ["install", "--save-exact", "--no-fund", "--no-audit", spec]));
  const uninstall = params.packageManager?.uninstall ?? ((toolPaths: Paths, packageName: string) => runNpm(toolPaths, ["uninstall", "--no-fund", "--no-audit", packageName]));
  const loadToolFromPaths = params.moduleLoader
    ? async (toolPaths: Paths, packageName: string) => {
        const loaded = await params.moduleLoader!(toolPaths, packageName);
        return parseLoadedTool(
          loaded.packageName,
          loaded.packageVersion,
          loaded.cliTool,
        );
      }
    : loadInstalledToolFromFs;
  const loadInstalledTool = loadToolFromPaths;
  const inspectLatest = params.packageManager?.inspectLatest
    ? async (toolPaths: Paths, packageName: string) => {
        const loaded = await params.packageManager!.inspectLatest!(
          toolPaths,
          packageName,
        );
        return parseLoadedTool(loaded.packageName, loaded.packageVersion, loaded.cliTool);
      }
    : async (_toolPaths: Paths, packageName: string) => {
        const rootDir = mkdtempSync(join(tmpdir(), "moneyos-tool-inspect-"));
        const inspectPaths: Paths = {
          rootDir,
          packageJsonPath: join(rootDir, "package.json"),
          registryPath: join(rootDir, "registry.json"),
        };
        try {
          ensureToolHome(inspectPaths, sharedToolHomeDependencies);
          await runNpm(inspectPaths, [
            "install",
            "--save-exact",
            "--no-fund",
            "--no-audit",
            `${packageName}@latest`,
          ]);
          return await loadToolFromPaths(inspectPaths, packageName);
        } finally {
          rmSync(rootDir, { recursive: true, force: true });
        }
      };
  const sameMetadata = (left: ToolRegistryEntry, right: ToolRegistryEntry) =>
    left.packageName === right.packageName
    && left.packageVersion === right.packageVersion
    && left.toolVersion === right.toolVersion
    && left.name === right.name
    && left.description === right.description
    && left.commandPath.join("\0") === right.commandPath.join("\0");
  const resolveInstalledTool = (input: string, entries: ToolRegistryEntry[]) =>
    entries.find((entry) => entry.packageName === input)
    ?? entries.find((entry) => entry.packageName === FIRST_PARTY_TOOL_ALIASES[input])
    ?? (() => {
      const matches = entries.filter((entry) => entry.name === input || entry.commandPath.join(" ") === input);
      return matches.length === 1 ? matches[0] : undefined;
    })();
  const getRegistryEntries = (): ToolRegistryEntry[] => {
    ensureToolHome(paths, sharedToolHomeDependencies);
    const parsed = JSON.parse(readFileSync(paths.registryPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`Tool registry at ${paths.registryPath} is invalid.`);
    return parsed.map(parseRegistryEntry);
  };
  const writeRegistryEntries = (entries: ToolRegistryEntry[]): void => {
    ensureToolHome(paths, sharedToolHomeDependencies);
    writeFileSync(paths.registryPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  };

  async function invoke(entry: ToolRegistryEntry, args: string[]): Promise<void> {
    let command: Command;
    try {
      // Load/validation failures mean the installed tool itself is broken.
      const loaded = await loadInstalledTool(paths, entry.packageName);
      if (!sameMetadata(entry, loaded)) throw new Error("installed metadata does not match registry");
      command = loaded.createCommand(cliContext);
      if (!(command instanceof Command) || command.name() !== entry.commandPath[entry.commandPath.length - 1]) {
        throw new Error("createCommand() did not return the expected command");
      }
      command.exitOverride();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Installed tool ${entry.commandPath.join(" ")} is broken: ${message}. Run \`moneyos add ${entry.packageName}\` to repair it or \`moneyos remove ${entry.packageName}\` to uninstall it.`);
    }

    try {
      await command.parseAsync([process.execPath, entry.commandPath[entry.commandPath.length - 1], ...args]);
    } catch (error) {
      if (error instanceof CommanderError) {
        if (error.code !== "commander.helpDisplayed") process.exitCode = error.exitCode || 1;
        return;
      }
      throw error;
    }
  }

  return {
    getRegistryEntries(): ToolRegistryEntry[] {
      return getRegistryEntries();
    },
    mountInstalledToolCommands(program: Command): void {
      let entries: ToolRegistryEntry[];
      try {
        entries = getRegistryEntries();
      } catch {
        return;
      }
      reservedRootCommands = collectReservedRootCommandNames(program);
      const groups = new Map<string, Command>();
      for (const entry of entries) {
        if (getConflict(entry, entries, reservedRootCommands)) continue;
        let parent = program;
        const segments: string[] = [];
        for (const segment of entry.commandPath.slice(0, -1)) {
          segments.push(segment);
          const key = segments.join(" ");
          const group = groups.get(key) ?? new Command(segment).description("Installed MoneyOS tool commands");
          if (!groups.has(key)) {
            groups.set(key, group);
            parent.addCommand(group);
          }
          parent = group;
        }
        parent.addCommand(
          new Command(entry.commandPath[entry.commandPath.length - 1])
            .description(entry.description)
            .allowUnknownOption(true)
            .allowExcessArguments(true)
            .helpOption(false)
            .argument("[args...]")
            .action(async (args: string[]) => { await invoke(entry, args); }),
        );
      }
    },
    async addTool(input: string): Promise<ToolRegistryEntry> {
      const spec = FIRST_PARTY_TOOL_ALIASES[input] ?? input;
      const entries = getRegistryEntries();
      const previous = resolveInstalledTool(input, entries);
      ensureToolHome(paths, sharedToolHomeDependencies);
      const before = (JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {};
      await install(paths, spec);
      const after = (JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {};
      const changed = previous?.packageName ?? Object.keys(after).find((name) => before[name] !== after[name] && !sharedToolHomeDependencyNames.has(name));
      try {
        const loaded = await loadInstalledTool(paths, changed ?? spec);
        const next = previous ? entries.filter((entry) => entry.packageName !== previous.packageName) : entries;
        const conflict = getConflict(loaded, next, reservedRootCommands);
        if (conflict) throw new Error(conflict);
        const entry = { packageName: loaded.packageName, packageVersion: loaded.packageVersion, toolVersion: loaded.toolVersion, name: loaded.name, commandPath: loaded.commandPath, description: loaded.description };
        writeRegistryEntries([...next, entry]);
        return entry;
      } catch (error) {
        try {
          if (previous) await install(paths, `${previous.packageName}@${previous.packageVersion}`);
          else if (changed) await uninstall(paths, changed);
        } catch {
          // Best-effort rollback only.
        }
        throw error;
      }
    },
    async removeTool(input: string): Promise<ToolRegistryEntry> {
      const entries = getRegistryEntries();
      const entry = resolveInstalledTool(input, entries);
      if (!entry) throw new Error(`Tool ${input} is not installed.`);
      await uninstall(paths, entry.packageName);
      writeRegistryEntries(entries.filter((installed) => installed.packageName !== entry.packageName));
      return entry;
    },
    async listTools(): Promise<ToolStatus[]> {
      const entries = getRegistryEntries();
      const tools = await Promise.all(entries.map(async (entry) => {
        const conflict = getConflict(entry, entries, reservedRootCommands);
        if (conflict) return { ...entry, state: "conflict" as const, problems: [conflict] };
        try {
          const loaded = await loadInstalledTool(paths, entry.packageName);
          if (!sameMetadata(entry, loaded)) throw new Error("installed metadata does not match registry");
          return { ...entry, state: "ok" as const, problems: [] };
        } catch (error) {
          return { ...entry, state: "broken" as const, problems: [error instanceof Error ? error.message : String(error)] };
        }
      }));
      return tools.sort((left, right) => left.commandPath.join(" ").localeCompare(right.commandPath.join(" ")));
    },
    async updateTools(
      params: { tool?: string; check?: boolean } = {},
    ): Promise<ToolUpdateResult[]> {
      let entries = getRegistryEntries();
      const targets = params.tool
        ? (() => {
            const entry = resolveInstalledTool(params.tool!, entries);
            if (!entry) throw new Error(`Tool ${params.tool} is not installed.`);
            return [entry];
          })()
        : [...entries].sort((left, right) =>
            left.commandPath.join(" ").localeCompare(right.commandPath.join(" ")),
          );
      const results: ToolUpdateResult[] = [];

      for (const target of targets) {
        const current =
          entries.find((entry) => entry.packageName === target.packageName)
          ?? target;

        let latest: LoadedTool;
        try {
          latest = await inspectLatest(paths, current.packageName);
        } catch (error) {
          results.push({
            current,
            state:
              error instanceof UnsupportedToolContractVersionError
                ? "skipped"
                : "failed",
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const next = toRegistryEntry(latest);
        if (next.packageVersion === current.packageVersion) {
          results.push({ current, next, state: "up-to-date" });
          continue;
        }

        const otherEntries = entries.filter(
          (entry) => entry.packageName !== current.packageName,
        );
        const conflict = getConflict(next, otherEntries, reservedRootCommands);
        if (conflict) {
          results.push({ current, next, state: "skipped", reason: conflict });
          continue;
        }

        if (params.check) {
          results.push({ current, next, state: "would-update" });
          continue;
        }

        try {
          await install(paths, `${current.packageName}@${next.packageVersion}`);
          const applied = toRegistryEntry(
            await loadInstalledTool(paths, current.packageName),
          );
          const appliedConflict = getConflict(
            applied,
            otherEntries,
            reservedRootCommands,
          );
          if (appliedConflict) throw new Error(appliedConflict);
          if (applied.packageVersion !== next.packageVersion) {
            throw new Error(
              `Installed ${applied.packageName}@${applied.packageVersion}, expected ${next.packageVersion}.`,
            );
          }
          entries = entries.map((entry) =>
            entry.packageName === current.packageName ? applied : entry,
          );
          writeRegistryEntries(entries);
          results.push({ current, next: applied, state: "updated" });
        } catch (error) {
          try {
            await install(paths, `${current.packageName}@${current.packageVersion}`);
          } catch {
            // Best-effort rollback only.
          }
          results.push({
            current,
            next,
            state: "failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    },
  };
}

export function formatToolStatusTable(tools: ToolStatus[]): string {
  if (tools.length === 0) return "No tools installed.";
  const commandWidth = Math.max("COMMAND".length, ...tools.map((tool) => tool.commandPath.join(" ").length));
  const packageWidth = Math.max("PACKAGE".length, ...tools.map((tool) => tool.packageName.length));
  const versionWidth = Math.max("VERSION".length, ...tools.map((tool) => tool.packageVersion.length));
  const lines = [`${"COMMAND".padEnd(commandWidth)}  ${"PACKAGE".padEnd(packageWidth)}  ${"VERSION".padEnd(versionWidth)}  STATE`];
  for (const tool of tools) {
    lines.push(`${tool.commandPath.join(" ").padEnd(commandWidth)}  ${tool.packageName.padEnd(packageWidth)}  ${tool.packageVersion.padEnd(versionWidth)}  ${tool.state}`);
    for (const problem of tool.problems) lines.push(`  ${problem}`);
  }
  return lines.join("\n");
}

export function formatToolUpdateTable(results: ToolUpdateResult[]): string {
  if (results.length === 0) return "No tool updates to show.";
  const commandWidth = Math.max(
    "COMMAND".length,
    ...results.map((result) =>
      (result.next?.commandPath ?? result.current.commandPath).join(" ").length,
    ),
  );
  const packageWidth = Math.max(
    "PACKAGE".length,
    ...results.map((result) => result.current.packageName.length),
  );
  const currentWidth = Math.max(
    "CURRENT".length,
    ...results.map((result) => result.current.packageVersion.length),
  );
  const latestWidth = Math.max(
    "LATEST".length,
    ...results.map((result) => (result.next?.packageVersion ?? "-").length),
  );
  const lines = [
    `${"COMMAND".padEnd(commandWidth)}  ${"PACKAGE".padEnd(packageWidth)}  ${"CURRENT".padEnd(currentWidth)}  ${"LATEST".padEnd(latestWidth)}  STATUS`,
  ];
  for (const result of results) {
    const commandPath = (result.next?.commandPath ?? result.current.commandPath)
      .join(" ");
    lines.push(
      `${commandPath.padEnd(commandWidth)}  ${result.current.packageName.padEnd(packageWidth)}  ${result.current.packageVersion.padEnd(currentWidth)}  ${(result.next?.packageVersion ?? "-").padEnd(latestWidth)}  ${result.state}`,
    );
    if (result.reason) lines.push(`  ${result.reason}`);
  }
  return lines.join("\n");
}
