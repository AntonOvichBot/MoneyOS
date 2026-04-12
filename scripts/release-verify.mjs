import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const forbiddenPackedFileRules = [
  { reason: "source directory", matches: (file) => /(^|\/)src\//.test(file) },
  { reason: "test directory", matches: (file) => /(^|\/)tests?\//.test(file) },
  { reason: "test file", matches: (file) => /\.test\.[^/]+$/.test(file) },
  {
    reason: "TypeScript source file",
    matches: (file) => /\.(ts|tsx)$/.test(file) && !/\.d\.(cts|mts|ts)$/.test(file),
  },
  { reason: "tsconfig file", matches: (file) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file) },
  { reason: "dotenv file", matches: (file) => /(^|\/)\.env(?:\.[^/]+)?$/.test(file) },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function runJson(command, args, options = {}) {
  return JSON.parse(run(command, args, options));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
}

function assertPackedFiles(label, files, expectedPaths) {
  for (const expectedPath of expectedPaths) {
    if (!files.includes(expectedPath)) {
      throw new Error(`${label} tarball is missing ${expectedPath}.`);
    }
  }
}

function assertNoForbiddenPackedFiles(label, files) {
  const forbiddenFiles = [];
  for (const file of files) {
    for (const rule of forbiddenPackedFileRules) {
      if (rule.matches(file)) {
        forbiddenFiles.push(`${file} (${rule.reason})`);
      }
    }
  }
  if (forbiddenFiles.length > 0) {
    throw new Error(
      `${label} tarball ships forbidden files:\n${forbiddenFiles.join("\n")}`,
    );
  }
}

function assertChangelogContainsVersion(label, changelogPath, version) {
  const changelog = readFileSync(changelogPath, "utf8");
  const headingPattern = new RegExp(`^## ${escapeRegExp(version)} - `, "m");
  if (!headingPattern.test(changelog)) {
    throw new Error(
      `${label} changelog at ${changelogPath} is missing a heading for version ${version}.`,
    );
  }
}

// Callers must pass the exact package.json version string, including any
// pre-release suffix, not a prefix such as "0.5.0" for "0.5.0-beta.1".
function assertOutputIncludesVersion(label, output, version) {
  const versionPattern = new RegExp(`(^|\\b)${escapeRegExp(version)}(\\b|$)`);
  if (!versionPattern.test(output)) {
    throw new Error(
      `${label} version output mismatch: expected to contain ${version}, got ${output}.`,
    );
  }
}

function packPackage(packageDir, packDestination) {
  const output = runJson(
    "npm",
    ["pack", "--json", "--pack-destination", packDestination],
    { cwd: packageDir },
  );
  if (!Array.isArray(output) || output.length !== 1) {
    throw new Error(`Expected one pack result for ${packageDir}.`);
  }
  return output[0];
}

function smokeCommonJs(cwd, script, expectedOutput, label) {
  const output = run("node", ["-e", script], { cwd });
  if (output !== expectedOutput) {
    throw new Error(`${label} CJS smoke output mismatch: ${output}.`);
  }
}

function smokeMoneyos(tarballPath, expectedVersion) {
  const installDir = mkdtempSync(join(tmpdir(), "moneyos-release-root-"));
  try {
    run("npm", ["init", "-y"], { cwd: installDir });
    run("npm", ["install", tarballPath], { cwd: installDir });

    const versionOutput = run(
      "npx",
      ["--no-install", "moneyos", "--version"],
      { cwd: installDir },
    );
    assertOutputIncludesVersion("moneyos", versionOutput, expectedVersion);

    const helpOutput = run(
      "npx",
      ["--no-install", "moneyos", "--help"],
      { cwd: installDir },
    );
    if (!helpOutput) throw new Error("Installed moneyos --help output is empty.");

    smokeCommonJs(
      installDir,
      "const pkg = require('moneyos'); if (typeof pkg.createMoneyOS !== 'function') throw new Error('missing createMoneyOS'); process.stdout.write('ok');",
      "ok",
      "moneyos",
    );
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

function smokeCore(tarballPath) {
  const installDir = mkdtempSync(join(tmpdir(), "moneyos-release-core-"));
  try {
    run("npm", ["init", "-y"], { cwd: installDir });
    run("npm", ["install", tarballPath, "viem"], { cwd: installDir });

    const output = run(
      "node",
      [
        "--input-type=module",
        "-e",
        "import { getChain } from '@moneyos/core'; process.stdout.write(String(getChain(42161).id));",
      ],
      { cwd: installDir },
    );
    if (output !== "42161") {
      throw new Error(`Installed @moneyos/core smoke output mismatch: ${output}.`);
    }

    smokeCommonJs(
      installDir,
      "const { getChain } = require('@moneyos/core'); process.stdout.write(String(getChain(42161).id));",
      "42161",
      "@moneyos/core",
    );
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

function smokeSwap(coreTarballPath, swapTarballPath) {
  const installDir = mkdtempSync(join(tmpdir(), "moneyos-release-swap-"));
  try {
    run("npm", ["init", "-y"], { cwd: installDir });
    run(
      "npm",
      ["install", coreTarballPath, swapTarballPath, "viem"],
      { cwd: installDir },
    );

    const output = run(
      "node",
      [
        "--input-type=module",
        "-e",
        "import { createSwapTool, moneyosCliTool } from '@moneyos/swap'; if (typeof createSwapTool !== 'function') throw new Error('missing createSwapTool'); process.stdout.write(moneyosCliTool.commandPath.join(' '));",
      ],
      { cwd: installDir },
    );
    if (output !== "swap") {
      throw new Error(`Installed @moneyos/swap smoke output mismatch: ${output}.`);
    }

    smokeCommonJs(
      installDir,
      "const { createSwapTool, moneyosCliTool } = require('@moneyos/swap'); if (typeof createSwapTool !== 'function') throw new Error('missing createSwapTool'); process.stdout.write(moneyosCliTool.commandPath.join(' '));",
      "swap",
      "@moneyos/swap",
    );
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

function main() {
  run("npm", ["run", "build"], { cwd: repoRoot });
  run("npm", ["run", "build:swap"], { cwd: repoRoot });

  const rootPackage = readPackageJson(repoRoot);
  const corePackage = readPackageJson(join(repoRoot, "packages/core"));
  const swapPackage = readPackageJson(join(repoRoot, "packages/swap"));

  assertChangelogContainsVersion("moneyos", join(repoRoot, "CHANGELOG.md"), rootPackage.version);
  assertChangelogContainsVersion("@moneyos/core", join(repoRoot, "packages/core/CHANGELOG.md"), corePackage.version);
  assertChangelogContainsVersion("@moneyos/swap", join(repoRoot, "packages/swap/CHANGELOG.md"), swapPackage.version);

  const packDestination = mkdtempSync(join(tmpdir(), "moneyos-pack-"));

  try {
    const rootPack = packPackage(repoRoot, packDestination);
    const rootFiles = rootPack.files.map((file) => file.path);
    assertPackedFiles(
      "moneyos",
      rootFiles,
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.cjs", "dist/cli/index.js"],
    );
    assertNoForbiddenPackedFiles("moneyos", rootFiles);
    smokeMoneyos(join(packDestination, rootPack.filename), rootPackage.version);

    const corePack = packPackage(join(repoRoot, "packages/core"), packDestination);
    const coreFiles = corePack.files.map((file) => file.path);
    assertPackedFiles(
      "@moneyos/core",
      coreFiles,
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.cjs"],
    );
    assertNoForbiddenPackedFiles("@moneyos/core", coreFiles);
    smokeCore(join(packDestination, corePack.filename));

    const swapPack = packPackage(join(repoRoot, "packages/swap"), packDestination);
    const swapFiles = swapPack.files.map((file) => file.path);
    assertPackedFiles(
      "@moneyos/swap",
      swapFiles,
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.cjs"],
    );
    assertNoForbiddenPackedFiles("@moneyos/swap", swapFiles);
    smokeSwap(
      join(packDestination, corePack.filename),
      join(packDestination, swapPack.filename),
    );
  } finally {
    rmSync(packDestination, { recursive: true, force: true });
  }
}

main();
