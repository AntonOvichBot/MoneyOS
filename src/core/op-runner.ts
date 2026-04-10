import { spawn } from "node:child_process";

/**
 * OpRunner — a narrow shell-execution abstraction for the `op` CLI.
 *
 * The whole reason this interface exists is to make `OnePasswordKeyStore`
 * testable without shelling out to a real `op` binary (which would require
 * a live 1Password account, the desktop app, biometric auth, etc.). Tests
 * provide a mock `OpRunner` that returns canned JSON; production code uses
 * the default `ChildProcessOpRunner` which spawns the real `op` process.
 *
 * The surface is deliberately minimal. Everything the 1Password keystore
 * needs fits in one method:
 *   - `op item create --format json -`  (template on stdin)
 *   - `op read op://<vault>/<item>/private_key --no-newline`
 *   - `op item get <id> --vault <vaultId> --format json`
 *
 * Each of those is a single invocation with argv, optional stdin, and a
 * bounded output that comfortably fits in memory. No streaming, no chunked
 * APIs, no long-running processes.
 */

export interface OpRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface OpRunOptions {
  /**
   * Data to write to the child process's stdin. Used to pipe the item
   * creation JSON template so the secret never appears in argv or shell
   * history. When omitted, the child's stdin is closed immediately.
   */
  stdin?: string;
}

export interface OpRunner {
  /**
   * Execute `op` with the given arguments. The implementation owns how the
   * binary is located (PATH, explicit path, etc.). Returns stdout, stderr,
   * and the exit code; a non-zero exit code is NOT thrown — callers decide
   * how to interpret it (e.g. `op item get` exiting non-zero may mean the
   * item was deleted, which is recoverable).
   */
  run(args: string[], options?: OpRunOptions): Promise<OpRunResult>;
}

export interface ChildProcessOpRunnerOptions {
  /**
   * Path to the `op` binary. Defaults to `"op"`, which relies on the user's
   * PATH. Primarily useful for tests (which point at a fake binary) and
   * for installations where `op` lives outside PATH.
   */
  binary?: string;
}

/**
 * Default `OpRunner` implementation backed by `child_process.spawn`.
 *
 * Uses `spawn` (not `exec`) because:
 *   - `spawn` accepts an argv array, avoiding shell-quoting pitfalls;
 *   - `spawn` lets us write to stdin directly so the item-creation template
 *     goes over a pipe rather than showing up in process argv.
 */
export class ChildProcessOpRunner implements OpRunner {
  private binary: string;

  constructor(options: ChildProcessOpRunnerOptions = {}) {
    this.binary = options.binary ?? "op";
  }

  run(args: string[], options: OpRunOptions = {}): Promise<OpRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        // Spawn-level failures (binary not found, permission denied, etc.)
        // surface here. Wrap with enough context to make the failure mode
        // obvious to the caller.
        reject(
          new Error(
            `OpRunner: failed to spawn \`${this.binary}\`: ${error.message}`,
            { cause: error },
          ),
        );
      });

      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });

      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    });
  }
}
