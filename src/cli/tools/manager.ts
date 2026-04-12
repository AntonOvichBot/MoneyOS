import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import type { MoneyOSCliContext, MoneyOSCliTool } from "../../cli-tool.js";
import {
  getToolHomeDir,
  getToolHomePackageJsonPath,
  getToolRegistryPath,
} from "../config.js";
import { createMoneyOSCliContext } from "./runtime.js";

const RESERVED_ROOT_COMMANDS = new Set([
  "init",
  "auth",
  "backup",
  "balance",
  "send",
  "keystore",
  "add",
  "remove",
  "tools",
  "help",
  "__session-daemon",
]);

const FIRST_PARTY_TOOL_ALIASES: Record<string, string> = {
  swap: "@moneyos/swap",
};

const TOOL_HOME_PACKAGE_JSON = {
  name: "moneyos-tools",
  private: true,
  description: "User-level installed MoneyOS CLI tools",
};

const VALID_COMMAND_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export interface ToolRegistryEntry {
  packageName: string;
  packageVersion: string;
  toolVersion: 1;
  name: string;
  commandPath: string[];
  description: string;
}

export interface ToolStatus extends ToolRegistryEntry {
  state: "ok" | "broken" | "conflict";
  problems: string[];
}

export interface ToolHomePaths {
  rootDir: string;
  packageJsonPath: string;
  registryPath: string;
}

export interface LoadedInstalledTool {
  packageName: string;
  packageVersion: string;
  cliTool: MoneyOSCliTool;
}

export interface CliToolPackageManager {
  install(paths: ToolHomePaths, spec: string): Promise<void>;
  uninstall(paths: ToolHomePaths, packageName: string): Promise<void>;
}

export interface CliToolModuleLoader {
  loadInstalledTool(
    paths: ToolHomePaths,
    packageName: string,
  ): Promise<LoadedInstalledTool>;
}

export interface CliToolManager {
  getRegistryEntries(): ToolRegistryEntry[];
  mountInstalledToolCommands(program: Command): void;
  addTool(input: string): Promise<ToolRegistryEntry>;
  removeTool(input: string): Promise<ToolRegistryEntry>;
  listTools(): Promise<ToolStatus[]>;
}

export interface CreateCliToolManagerDependencies {
  paths?: ToolHomePaths;
  packageManager?: CliToolPackageManager;
  moduleLoader?: CliToolModuleLoader;
  cliContext?: MoneyOSCliContext;
}

function defaultToolHomePaths(): ToolHomePaths {
  return {
    rootDir: getToolHomeDir(),
    packageJsonPath: getToolHomePackageJsonPath(),
    registryPath: getToolRegistryPath(),
  };
}

function ensureToolHome(paths: ToolHomePaths): void {
  if (!existsSync(paths.rootDir)) {
    mkdirSync(paths.rootDir, { recursive: true, mode: 0o700 });
  }

  if (!existsSync(paths.packageJsonPath)) {
    writeFileSync(
      paths.packageJsonPath,
      `${JSON.stringify(TOOL_HOME_PACKAGE_JSON, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  if (!existsSync(paths.registryPath)) {
    writeFileSync(paths.registryPath, "[]\n", { mode: 0o600 });
  }
}

function readToolHomeDependencies(paths: ToolHomePaths): Record<string, string> {
  ensureToolHome(paths);
  const parsed = JSON.parse(
    readFileSync(paths.packageJsonPath, "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
  return { ...(parsed.dependencies ?? {}) };
}

function readRegistry(paths: ToolHomePaths): ToolRegistryEntry[] {
  ensureToolHome(paths);

  const parsed = JSON.parse(
    readFileSync(paths.registryPath, "utf8"),
  ) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Tool registry at ${paths.registryPath} is invalid. Expected a JSON array.`,
    );
  }

  return parsed.map((entry) => validateRegistryEntry(entry));
}

function writeRegistry(paths: ToolHomePaths, entries: ToolRegistryEntry[]): void {
  ensureToolHome(paths);
  writeFileSync(
    paths.registryPath,
    `${JSON.stringify(entries, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function validateRegistryEntry(value: unknown): ToolRegistryEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error("Tool registry entry must be an object.");
  }

  const entry = value as Partial<ToolRegistryEntry>;
  if (typeof entry.packageName !== "string" || entry.packageName.length === 0) {
    throw new Error("Tool registry entry is missing packageName.");
  }
  if (
    typeof entry.packageVersion !== "string"
    || entry.packageVersion.length === 0
  ) {
    throw new Error(`Tool registry entry ${entry.packageName} is missing packageVersion.`);
  }
  if (entry.toolVersion !== 1) {
    throw new Error(
      `Tool registry entry ${entry.packageName} has unsupported toolVersion ${String(entry.toolVersion)}.`,
    );
  }
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    throw new Error(`Tool registry entry ${entry.packageName} is missing name.`);
  }
  if (typeof entry.description !== "string" || entry.description.length === 0) {
    throw new Error(`Tool registry entry ${entry.packageName} is missing description.`);
  }
  if (!Array.isArray(entry.commandPath) || entry.commandPath.length === 0) {
    throw new Error(`Tool registry entry ${entry.packageName} is missing commandPath.`);
  }

  validateCommandPath(entry.commandPath, entry.packageName);

  return {
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    toolVersion: 1,
    name: entry.name,
    commandPath: [...entry.commandPath],
    description: entry.description,
  };
}

function validateCommandPath(commandPath: string[], packageName: string): void {
  for (const segment of commandPath) {
    if (typeof segment !== "string" || !VALID_COMMAND_SEGMENT.test(segment)) {
      throw new Error(
        `Package ${packageName} exports an invalid commandPath segment "${String(segment)}".`,
      );
    }
  }
}

function validateCliToolExport(
  value: unknown,
  packageName: string,
): MoneyOSCliTool {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Package ${packageName} does not export \`moneyosCliTool\`.`);
  }

  const cliTool = value as Partial<MoneyOSCliTool>;

  if (cliTool.version !== 1) {
    throw new Error(
      `Package ${packageName} exports unsupported moneyosCliTool.version ${String(cliTool.version)}. Expected 1.`,
    );
  }
  if (typeof cliTool.name !== "string" || cliTool.name.length === 0) {
    throw new Error(`Package ${packageName} exports a missing tool name.`);
  }
  if (
    typeof cliTool.description !== "string"
    || cliTool.description.length === 0
  ) {
    throw new Error(`Package ${packageName} exports a missing tool description.`);
  }
  if (!Array.isArray(cliTool.commandPath) || cliTool.commandPath.length === 0) {
    throw new Error(`Package ${packageName} exports a missing commandPath.`);
  }
  if (typeof cliTool.createCommand !== "function") {
    throw new Error(`Package ${packageName} exports a missing createCommand(ctx) function.`);
  }

  validateCommandPath(cliTool.commandPath, packageName);

  return {
    version: 1,
    name: cliTool.name,
    commandPath: [...cliTool.commandPath],
    description: cliTool.description,
    createCommand: cliTool.createCommand,
  };
}

function isCommandLike(value: unknown): value is Command {
  const candidate = value as Partial<Command>;
  return typeof candidate === "object"
    && candidate !== null
    && typeof candidate.name === "function"
    && typeof candidate.parseAsync === "function"
    && typeof candidate.helpInformation === "function";
}

function isCommanderLikeError(
  value: unknown,
): value is { code: string; exitCode?: number } {
  const candidate = value as { code?: unknown; exitCode?: unknown };
  return typeof candidate === "object"
    && candidate !== null
    && typeof candidate.code === "string"
    && (
      candidate.exitCode === undefined
      || typeof candidate.exitCode === "number"
    );
}

function validateCreatedCommand(
  value: unknown,
  entry: ToolRegistryEntry,
): Command {
  if (!isCommandLike(value)) {
    throw new Error(
      `Package ${entry.packageName} createCommand() must return a Commander Command.`,
    );
  }

  const expectedLeaf = entry.commandPath[entry.commandPath.length - 1];
  if (value.name() !== expectedLeaf) {
    throw new Error(
      `Package ${entry.packageName} createCommand() must return a command named "${expectedLeaf}".`,
    );
  }

  return value;
}

function commandPathToString(commandPath: string[]): string {
  return commandPath.join(" ");
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function buildRegistryEntry(loaded: LoadedInstalledTool): ToolRegistryEntry {
  return {
    packageName: loaded.packageName,
    packageVersion: loaded.packageVersion,
    toolVersion: loaded.cliTool.version,
    name: loaded.cliTool.name,
    commandPath: [...loaded.cliTool.commandPath],
    description: loaded.cliTool.description,
  };
}

function registryEntriesMatch(
  entry: ToolRegistryEntry,
  loaded: LoadedInstalledTool,
): string[] {
  const problems: string[] = [];

  if (entry.packageName !== loaded.packageName) {
    problems.push(
      `registry package ${entry.packageName} does not match installed package ${loaded.packageName}`,
    );
  }
  if (entry.packageVersion !== loaded.packageVersion) {
    problems.push(
      `registry version ${entry.packageVersion} does not match installed version ${loaded.packageVersion}`,
    );
  }
  if (entry.toolVersion !== loaded.cliTool.version) {
    problems.push(
      `registry tool version ${entry.toolVersion} does not match installed tool version ${loaded.cliTool.version}`,
    );
  }
  if (entry.name !== loaded.cliTool.name) {
    problems.push(
      `registry name ${entry.name} does not match installed tool name ${loaded.cliTool.name}`,
    );
  }
  if (!pathsEqual(entry.commandPath, loaded.cliTool.commandPath)) {
    problems.push(
      `registry command path ${commandPathToString(entry.commandPath)} does not match installed command path ${commandPathToString(loaded.cliTool.commandPath)}`,
    );
  }
  if (entry.description !== loaded.cliTool.description) {
    problems.push("registry description does not match the installed tool description");
  }

  return problems;
}

function resolveAddSpecifier(input: string): string {
  return FIRST_PARTY_TOOL_ALIASES[input] ?? input;
}

function createDefaultPackageManager(): CliToolPackageManager {
  async function runNpm(paths: ToolHomePaths, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", args, {
        cwd: paths.rootDir,
        stdio: "pipe",
      });

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            stderr.trim() || `npm ${args[0]} failed with exit code ${String(code)}.`,
          ),
        );
      });
    });
  }

  return {
    install(paths, spec) {
      ensureToolHome(paths);
      return runNpm(paths, [
        "install",
        "--save-exact",
        "--no-fund",
        "--no-audit",
        spec,
      ]);
    },
    uninstall(paths, packageName) {
      ensureToolHome(paths);
      return runNpm(paths, [
        "uninstall",
        "--no-fund",
        "--no-audit",
        packageName,
      ]);
    },
  };
}

function findPackageRoot(resolvedEntryPath: string, packageName: string): string {
  let current = dirname(resolvedEntryPath);

  while (current !== dirname(current)) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
      };
      if (parsed.name === packageName) {
        return current;
      }
    }
    current = dirname(current);
  }

  throw new Error(`Could not find package.json for installed package ${packageName}.`);
}

function createDefaultModuleLoader(): CliToolModuleLoader {
  return {
    async loadInstalledTool(paths, packageName) {
      const toolRequire = createRequire(paths.packageJsonPath);

      let resolvedEntryPath: string;
      try {
        resolvedEntryPath = toolRequire.resolve(packageName);
      } catch {
        throw new Error(
          `Package ${packageName} is missing from ${join(paths.rootDir, "node_modules")}.`,
        );
      }

      const packageRoot = findPackageRoot(resolvedEntryPath, packageName);
      const packageJsonPath = join(packageRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
        version?: string;
      };

      if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
        throw new Error(`Installed package at ${packageRoot} is missing a valid name.`);
      }
      if (
        typeof packageJson.version !== "string"
        || packageJson.version.length === 0
      ) {
        throw new Error(`Installed package ${packageJson.name} is missing a valid version.`);
      }

      const moduleNamespace = await import(pathToFileURL(resolvedEntryPath).href);
      const exportedTool =
        (moduleNamespace as Record<string, unknown>).moneyosCliTool
        ?? (
          (moduleNamespace as Record<string, unknown>).default as
            | Record<string, unknown>
            | undefined
        )?.moneyosCliTool;

      return {
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        cliTool: validateCliToolExport(exportedTool, packageJson.name),
      };
    },
  };
}

interface TrieNode {
  leafOwner?: number;
  children: Map<string, TrieNode>;
}

function createTrieNode(): TrieNode {
  return {
    children: new Map(),
  };
}

function buildPathConflicts(entries: ToolRegistryEntry[]): Map<number, string[]> {
  const root = createTrieNode();
  const conflicts = new Map<number, string[]>();

  const addConflict = (index: number, message: string) => {
    const existing = conflicts.get(index) ?? [];
    existing.push(message);
    conflicts.set(index, existing);
  };

  for (const [index, entry] of entries.entries()) {
    const topLevel = entry.commandPath[0];
    if (RESERVED_ROOT_COMMANDS.has(topLevel) || RESERVED_ROOT_COMMANDS.has(entry.name)) {
      addConflict(
        index,
        `reserved root command collision for ${commandPathToString(entry.commandPath)}`,
      );
      continue;
    }

    let node = root;
    let conflictFound = false;

    for (const [segmentIndex, segment] of entry.commandPath.entries()) {
      if (node.leafOwner !== undefined) {
        const owner = entries[node.leafOwner];
        addConflict(
          index,
          `command path ${commandPathToString(entry.commandPath)} collides with installed tool path ${commandPathToString(owner.commandPath)}`,
        );
        conflictFound = true;
        break;
      }

      if (!node.children.has(segment)) {
        node.children.set(segment, createTrieNode());
      }

      node = node.children.get(segment)!;

      const isLeaf = segmentIndex === entry.commandPath.length - 1;
      if (isLeaf) {
        if (node.leafOwner !== undefined) {
          const owner = entries[node.leafOwner];
          addConflict(
            index,
            `command path ${commandPathToString(entry.commandPath)} collides with installed tool path ${commandPathToString(owner.commandPath)}`,
          );
          conflictFound = true;
          break;
        }

        if (node.children.size > 0) {
          const conflictingChild = [...node.children.keys()][0];
          addConflict(
            index,
            `command path ${commandPathToString(entry.commandPath)} collides with an installed nested tool path starting at ${commandPathToString([...entry.commandPath, conflictingChild])}`,
          );
          conflictFound = true;
          break;
        }

        node.leafOwner = index;
      }
    }

    if (conflictFound) {
      continue;
    }
  }

  return conflicts;
}

function createRepairError(entry: ToolRegistryEntry, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Installed tool ${commandPathToString(entry.commandPath)} is broken: ${message}. Run \`moneyos add ${entry.packageName}\` to repair it or \`moneyos remove ${entry.packageName}\` to uninstall it.`,
  );
}

function formatAddedToolMessage(entry: ToolRegistryEntry): string {
  return `Installed ${entry.packageName}@${entry.packageVersion} as \`moneyos ${commandPathToString(entry.commandPath)}\`.`;
}

function determineChangedDependency(
  before: Record<string, string>,
  after: Record<string, string>,
  fallbackPackageName?: string,
): string | undefined {
  const changed = new Set<string>();
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] !== after[name]) {
      changed.add(name);
    }
  }

  if (fallbackPackageName && changed.has(fallbackPackageName)) {
    return fallbackPackageName;
  }

  return changed.size === 1 ? [...changed][0] : fallbackPackageName;
}

function resolveInstalledToolTarget(
  input: string,
  entries: ToolRegistryEntry[],
): ToolRegistryEntry | undefined {
  const aliasPackageName = FIRST_PARTY_TOOL_ALIASES[input];

  const exactPackage = entries.find((entry) => entry.packageName === input);
  if (exactPackage) {
    return exactPackage;
  }

  if (aliasPackageName) {
    const aliased = entries.find((entry) => entry.packageName === aliasPackageName);
    if (aliased) {
      return aliased;
    }
  }

  const byName = entries.filter((entry) => entry.name === input);
  if (byName.length === 1) {
    return byName[0];
  }

  const byCommandPath = entries.filter(
    (entry) => commandPathToString(entry.commandPath) === input,
  );
  if (byCommandPath.length === 1) {
    return byCommandPath[0];
  }

  return undefined;
}

function validateInstallAgainstRegistry(
  candidate: ToolRegistryEntry,
  installedEntries: ToolRegistryEntry[],
  previousEntry?: ToolRegistryEntry,
): void {
  const remainingEntries = previousEntry
    ? installedEntries.filter((entry) => entry.packageName !== previousEntry.packageName)
    : installedEntries;

  if (RESERVED_ROOT_COMMANDS.has(candidate.name)) {
    throw new Error(
      `Tool name ${candidate.name} is reserved by the root MoneyOS CLI.`,
    );
  }

  const conflicts = buildPathConflicts([...remainingEntries, candidate]);
  const candidateProblems = conflicts.get(remainingEntries.length) ?? [];
  if (candidateProblems.length > 0) {
    throw new Error(candidateProblems.join("; "));
  }
}

async function invokeInstalledToolCommand(params: {
  entry: ToolRegistryEntry;
  args: string[];
  paths: ToolHomePaths;
  moduleLoader: CliToolModuleLoader;
  cliContext: MoneyOSCliContext;
}): Promise<void> {
  let loaded: LoadedInstalledTool;
  try {
    loaded = await params.moduleLoader.loadInstalledTool(
      params.paths,
      params.entry.packageName,
    );
  } catch (error) {
    throw createRepairError(params.entry, error);
  }

  const mismatches = registryEntriesMatch(params.entry, loaded);
  if (mismatches.length > 0) {
    throw createRepairError(params.entry, new Error(mismatches.join("; ")));
  }

  let command: Command;
  try {
    command = validateCreatedCommand(
      loaded.cliTool.createCommand(params.cliContext),
      params.entry,
    );
  } catch (error) {
    throw createRepairError(params.entry, error);
  }

  command.exitOverride();

  try {
    await command.parseAsync(
      [process.execPath, params.entry.commandPath[params.entry.commandPath.length - 1], ...params.args],
    );
  } catch (error) {
    if (isCommanderLikeError(error)) {
      if (error.code !== "commander.helpDisplayed") {
        process.exitCode = error.exitCode || 1;
      }
      return;
    }

    throw error;
  }
}

export function createCliToolManager(
  deps: CreateCliToolManagerDependencies = {},
): CliToolManager {
  const paths = deps.paths ?? defaultToolHomePaths();
  const packageManager = deps.packageManager ?? createDefaultPackageManager();
  const moduleLoader = deps.moduleLoader ?? createDefaultModuleLoader();
  const cliContext = deps.cliContext ?? createMoneyOSCliContext();

  function getRegistryEntries(): ToolRegistryEntry[] {
    return readRegistry(paths);
  }

  function mountInstalledToolCommands(program: Command): void {
    let entries: ToolRegistryEntry[];
    try {
      entries = getRegistryEntries();
    } catch {
      return;
    }

    const conflicts = buildPathConflicts(entries);
    const groups = new Map<string, Command>();

    const getParentCommand = (commandPath: string[]): Command => {
      if (commandPath.length === 1) {
        return program;
      }

      let parent = program;
      const accumulated: string[] = [];

      for (const segment of commandPath.slice(0, -1)) {
        accumulated.push(segment);
        const key = commandPathToString(accumulated);
        const existing = groups.get(key);
        if (existing) {
          parent = existing;
          continue;
        }

        const group = new Command(segment).description("Installed MoneyOS tool commands");
        parent.addCommand(group);
        groups.set(key, group);
        parent = group;
      }

      return parent;
    };

    for (const [index, entry] of entries.entries()) {
      if ((conflicts.get(index) ?? []).length > 0) {
        continue;
      }

      const parent = getParentCommand(entry.commandPath);
      const leaf = entry.commandPath[entry.commandPath.length - 1];

      parent.addCommand(
        new Command(leaf)
          .description(entry.description)
          .allowUnknownOption(true)
          .allowExcessArguments(true)
          .helpOption(false)
          .argument("[args...]")
          .action(async (args: string[]) => {
            await invokeInstalledToolCommand({
              entry,
              args,
              paths,
              moduleLoader,
              cliContext,
            });
          }),
      );
    }
  }

  async function addTool(input: string): Promise<ToolRegistryEntry> {
    const spec = resolveAddSpecifier(input);
    const installedEntries = getRegistryEntries();
    const previousEntry = resolveInstalledToolTarget(input, installedEntries);
    const dependenciesBefore = readToolHomeDependencies(paths);

    await packageManager.install(paths, spec);

    const dependenciesAfter = readToolHomeDependencies(paths);
    const changedDependency = determineChangedDependency(
      dependenciesBefore,
      dependenciesAfter,
      previousEntry?.packageName,
    );

    try {
      const loaded = await moduleLoader.loadInstalledTool(
        paths,
        changedDependency ?? spec,
      );
      const candidate = buildRegistryEntry(loaded);

      validateInstallAgainstRegistry(candidate, installedEntries, previousEntry);

      const nextEntries = previousEntry
        ? installedEntries.filter((entry) => entry.packageName !== previousEntry.packageName)
        : [...installedEntries];
      nextEntries.push(candidate);
      writeRegistry(paths, nextEntries);

      return candidate;
    } catch (error) {
      try {
        if (previousEntry) {
          await packageManager.install(
            paths,
            `${previousEntry.packageName}@${previousEntry.packageVersion}`,
          );
        } else if (changedDependency) {
          await packageManager.uninstall(paths, changedDependency);
        }
      } catch {
        // Best-effort rollback only.
      }

      throw error;
    }
  }

  async function removeTool(input: string): Promise<ToolRegistryEntry> {
    const installedEntries = getRegistryEntries();
    const entry = resolveInstalledToolTarget(input, installedEntries);

    if (!entry) {
      throw new Error(`Tool ${input} is not installed.`);
    }

    await packageManager.uninstall(paths, entry.packageName);
    writeRegistry(
      paths,
      installedEntries.filter((installed) => installed.packageName !== entry.packageName),
    );

    return entry;
  }

  async function listTools(): Promise<ToolStatus[]> {
    const entries = getRegistryEntries();
    const conflicts = buildPathConflicts(entries);

    const statuses = await Promise.all(entries.map(async (entry, index) => {
      const conflictProblems = conflicts.get(index) ?? [];
      if (conflictProblems.length > 0) {
        return {
          ...entry,
          state: "conflict" as const,
          problems: conflictProblems,
        };
      }

      try {
        const loaded = await moduleLoader.loadInstalledTool(paths, entry.packageName);
        const mismatches = registryEntriesMatch(entry, loaded);
        if (mismatches.length > 0) {
          return {
            ...entry,
            state: "broken" as const,
            problems: mismatches,
          };
        }

        return {
          ...entry,
          state: "ok" as const,
          problems: [],
        };
      } catch (error) {
        return {
          ...entry,
          state: "broken" as const,
          problems: [error instanceof Error ? error.message : String(error)],
        };
      }
    }));

    return statuses.sort((left, right) =>
      commandPathToString(left.commandPath).localeCompare(commandPathToString(right.commandPath)));
  }

  return {
    getRegistryEntries,
    mountInstalledToolCommands,
    addTool,
    removeTool,
    listTools,
  };
}

export function formatToolStatusTable(tools: ToolStatus[]): string {
  if (tools.length === 0) {
    return "No tools installed.";
  }

  const commandWidth = Math.max(
    "COMMAND".length,
    ...tools.map((tool) => commandPathToString(tool.commandPath).length),
  );
  const packageWidth = Math.max(
    "PACKAGE".length,
    ...tools.map((tool) => tool.packageName.length),
  );
  const versionWidth = Math.max(
    "VERSION".length,
    ...tools.map((tool) => tool.packageVersion.length),
  );

  const lines = [
    `${"COMMAND".padEnd(commandWidth)}  ${"PACKAGE".padEnd(packageWidth)}  ${"VERSION".padEnd(versionWidth)}  STATE`,
  ];

  for (const tool of tools) {
    lines.push(
      `${commandPathToString(tool.commandPath).padEnd(commandWidth)}  ${tool.packageName.padEnd(packageWidth)}  ${tool.packageVersion.padEnd(versionWidth)}  ${tool.state}`,
    );
    for (const problem of tool.problems) {
      lines.push(`  ${problem}`);
    }
  }

  return lines.join("\n");
}

export function formatAddedTool(entry: ToolRegistryEntry): string {
  return formatAddedToolMessage(entry);
}
