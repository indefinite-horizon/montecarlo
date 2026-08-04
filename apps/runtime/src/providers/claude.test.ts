/** Verifies Claude CLI authentication and stream normalization. */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeRunner } from "./claude.js";

const temporaryDirectories: string[] = [];

function fakeClaudeCli(): string {
  const directory = mkdtempSync(join(tmpdir(), "monte-carlo-claude-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "claude");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args.includes("--print")) {
  process.stdin.resume();
  process.stdin.on("end", () => {
    process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-1" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 2, output_tokens: 1 } }) + "\\n");
  });
}
`,
  );
  chmodSync(executable, 0o700);
  return executable;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ClaudeRunner", () => {
  it("uses the official CLI sign-in and normalizes streamed JSON", async () => {
    const runner = new ClaudeRunner({ CLAUDE_PATH: fakeClaudeCli() });
    await expect(runner.health()).resolves.toMatchObject({
      status: "ready",
      authenticated: true,
    });

    const events = [];
    for await (const event of runner.run(
      {
        provider: "anthropic",
        model: "sonnet",
        messages: [{ role: "user", content: "Hello" }],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "provider-thread", threadId: "session-1" },
      { type: "text-delta", delta: "hello" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      },
    ]);
  });
});
