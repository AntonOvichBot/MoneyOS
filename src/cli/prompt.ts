export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "This action requires a local terminal. Run it directly in your terminal, not through a non-interactive agent session.",
    );
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.pause();
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
    };

    const finish = (result?: string, error?: Error) => {
      cleanup();
      stdout.write("\n");
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? "");
    };

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          finish(undefined, new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdout.write(question);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}
