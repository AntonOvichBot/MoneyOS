import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function readJsonAtRef(ref, path) {
  const result = spawnSync("git", ["show", `${ref}:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

const eventName = process.env.GITHUB_EVENT_NAME;
const baseRef = process.env.GITHUB_BASE_REF;

if (eventName !== "pull_request") {
  console.log("Not a pull_request event; release PR shape check is a no-op.");
  process.exit(0);
}

if (!baseRef) {
  console.error("GITHUB_BASE_REF is not set; cannot determine base branch.");
  process.exit(1);
}

run("git", ["fetch", "origin", baseRef]);
const baseRefFull = `origin/${baseRef}`;

const packageJsonPaths = [
  "package.json",
  "packages/core/package.json",
  "packages/swap/package.json",
];

const bumps = [];
for (const pkgPath of packageJsonPaths) {
  if (!existsSync(`${repoRoot}/${pkgPath}`)) continue;
  const current = JSON.parse(readFileSync(`${repoRoot}/${pkgPath}`, "utf8"));
  const base = readJsonAtRef(baseRefFull, pkgPath);
  if (base && current.version !== base.version) {
    bumps.push({
      path: pkgPath,
      name: current.name,
      fromVersion: base.version,
      toVersion: current.version,
    });
  }
}

if (bumps.length === 0) {
  console.log("No version bumps detected. Release PR shape check is a no-op.");
  process.exit(0);
}

console.log("Detected version bumps:");
for (const bump of bumps) {
  console.log(
    `  ${bump.name}: ${bump.fromVersion} -> ${bump.toVersion} (${bump.path})`,
  );
}

const allowedPatterns = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^CHANGELOG\.md$/,
  /^packages\/[^/]+\/package\.json$/,
  /^packages\/[^/]+\/CHANGELOG\.md$/,
];

const changedFiles = run("git", [
  "diff",
  "--name-only",
  `${baseRefFull}...HEAD`,
])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const disallowed = changedFiles.filter(
  (file) => !allowedPatterns.some((pattern) => pattern.test(file)),
);

if (disallowed.length > 0) {
  console.error(
    "Release PRs must only change package.json, CHANGELOG.md, or package-lock.json.",
  );
  console.error("Disallowed files in this PR:");
  for (const file of disallowed) console.error(`  ${file}`);
  process.exit(1);
}

for (const bump of bumps) {
  const dir =
    bump.path === "package.json"
      ? ""
      : bump.path.replace(/\/package\.json$/, "");
  const changelogPath = dir ? `${dir}/CHANGELOG.md` : "CHANGELOG.md";
  if (!existsSync(`${repoRoot}/${changelogPath}`)) {
    console.error(
      `Missing CHANGELOG.md for ${bump.name} (expected at ${changelogPath}).`,
    );
    process.exit(1);
  }
  const changelog = readFileSync(
    `${repoRoot}/${changelogPath}`,
    "utf8",
  );
  if (!changelog.includes(bump.toVersion)) {
    console.error(
      `${changelogPath} must contain an entry for version ${bump.toVersion}.`,
    );
    process.exit(1);
  }
}

console.log("Release PR shape OK.");
