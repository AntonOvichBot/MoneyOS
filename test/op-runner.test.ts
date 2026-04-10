import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChildProcessOpRunner } from "../src/index.js";

// A tiny Node script that stands in for the real `op` binary. It echoes
// the argv it received and any stdin it was piped, as a JSON blob. This
// lets the test assert on exactly what OpRunner handed to the child
// process — no real 1Password dependency required.
//
// Supported pseudo-flags:
//   --fail-with <n>  : exit with code n instead of 0
//   --stderr-only    : write the JSON blob to stderr, leaving stdout empty
const FAKE_OP_SCRIPT = `#!/usr/bin/env node
const argv = process.argv.slice(2);
let stdin = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.stringify({ argv, stdin });
  const failIndex = argv.indexOf("--fail-with");
  const exitCode = failIndex >= 0 ? parseInt(argv[failIndex + 1], 10) : 0;
  if (argv.includes("--stderr-only")) {
    process.stderr.write(payload);
  } else {
    process.stdout.write(payload);
  }
  process.exit(exitCode);
});
`;

describe("ChildProcessOpRunner", () => {
  let tmpDir: string;
  let fakeOpPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-op-runner-"));
    fakeOpPath = join(tmpDir, "op");
    writeFileSync(fakeOpPath, FAKE_OP_SCRIPT);
    chmodSync(fakeOpPath, 0o755);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes argv verbatim to the child process", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const result = await runner.run(["item", "get", "abc123", "--format", "json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.argv).toEqual([
      "item",
      "get",
      "abc123",
      "--format",
      "json",
    ]);
    expect(parsed.stdin).toBe("");
  });

  it("pipes stdin to the child process", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const template = JSON.stringify({
      title: "MoneyOS key",
      fields: [{ label: "private_key", type: "CONCEALED", value: "0xdeadbeef" }],
    });

    const result = await runner.run(["item", "create", "-"], {
      stdin: template,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.argv).toEqual(["item", "create", "-"]);
    expect(parsed.stdin).toBe(template);
  });

  it("returns non-zero exit codes without throwing", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const result = await runner.run(["--fail-with", "2"]);

    expect(result.exitCode).toBe(2);
    // Even on failure the fake still writes its payload
    const parsed = JSON.parse(result.stdout);
    expect(parsed.argv).toEqual(["--fail-with", "2"]);
  });

  it("captures stderr separately from stdout", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const result = await runner.run(["--stderr-only", "boom"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    const parsed = JSON.parse(result.stderr);
    expect(parsed.argv).toEqual(["--stderr-only", "boom"]);
  });

  it("rejects with context when the binary cannot be spawned", async () => {
    const runner = new ChildProcessOpRunner({
      binary: join(tmpDir, "does-not-exist"),
    });

    await expect(runner.run(["anything"])).rejects.toThrow(
      /failed to spawn/,
    );
  });

  it("defaults the binary to 'op' when not specified", () => {
    // Construction should not throw or attempt to locate the binary.
    // The actual spawn is deferred to .run() — we just assert that the
    // default-constructor path is reachable without an explicit option.
    const runner = new ChildProcessOpRunner();
    expect(runner).toBeInstanceOf(ChildProcessOpRunner);
  });

  it("handles an empty argv list", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const result = await runner.run([]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.argv).toEqual([]);
  });

  it("handles stdin with newlines and unicode without corruption", async () => {
    const runner = new ChildProcessOpRunner({ binary: fakeOpPath });
    const payload = 'line1\nline2\n{"key":"value","emoji":"🔐"}';
    const result = await runner.run(["-"], { stdin: payload });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.stdin).toBe(payload);
  });
});
