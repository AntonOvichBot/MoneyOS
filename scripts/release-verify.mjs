import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

function assertPackedFiles(label, files, expectedPaths) {
  for (const expectedPath of expectedPaths) {
    if (!files.includes(expectedPath)) {
      throw new Error(`${label} tarball is missing ${expectedPath}.`);
    }
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
    if (versionOutput !== expectedVersion) {
      throw new Error(
        `Installed moneyos version output mismatch: expected ${expectedVersion}, got ${versionOutput}.`,
      );
    }

    const helpOutput = run(
      "npx",
      ["--no-install", "moneyos", "--help"],
      { cwd: installDir },
    );
    if (!helpOutput) throw new Error("Installed moneyos --help output is empty.");
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
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

function main() {
  run("npm", ["run", "build"], { cwd: repoRoot });
  run("npm", ["run", "build:swap"], { cwd: repoRoot });

  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const packDestination = mkdtempSync(join(tmpdir(), "moneyos-pack-"));

  try {
    const rootPack = packPackage(repoRoot, packDestination);
    assertPackedFiles(
      "moneyos",
      rootPack.files.map((file) => file.path),
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/cli/index.js"],
    );
    smokeMoneyos(join(packDestination, rootPack.filename), rootPackage.version);

    const corePack = packPackage(join(repoRoot, "packages/core"), packDestination);
    assertPackedFiles(
      "@moneyos/core",
      corePack.files.map((file) => file.path),
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js"],
    );
    smokeCore(join(packDestination, corePack.filename));

    const swapPack = packPackage(join(repoRoot, "packages/swap"), packDestination);
    assertPackedFiles(
      "@moneyos/swap",
      swapPack.files.map((file) => file.path),
      ["package.json", "README.md", "CHANGELOG.md", "dist/index.js"],
    );
    smokeSwap(
      join(packDestination, corePack.filename),
      join(packDestination, swapPack.filename),
    );
  } finally {
    rmSync(packDestination, { recursive: true, force: true });
  }
}

main();
