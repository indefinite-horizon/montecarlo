#!/usr/bin/env node
/** Deterministic Codex CLI protocol fixture for the signed desktop smoke test. */

import { createInterface } from "node:readline";

const packagedSmokeResponse = "Packaged Codex smoke response";
const arguments_ = process.argv.slice(2);

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (arguments_[0] === "login" && arguments_[1] === "status") {
  process.exit(0);
}

if (arguments_[0] === "debug" && arguments_[1] === "models") {
  writeMessage({
    models: [
      {
        slug: "smoke-codex",
        display_name: "Smoke Codex",
        description: "Deterministic packaged-app smoke model",
        visibility: "list",
        supported_reasoning_levels: [{ effort: "none" }],
        additional_speed_tiers: [],
      },
    ],
  });
  process.exit(0);
}

if (arguments_[0] !== "app-server" || !arguments_.includes("--stdio")) {
  process.stderr.write("Unsupported fake Codex invocation.\n");
  process.exit(2);
}

let threadSequence = 0;
const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write("Invalid app-server JSON.\n");
    process.exit(3);
  }

  if (!message || typeof message !== "object" || typeof message.method !== "string") return;
  if (message.method === "initialized") return;
  if (typeof message.id !== "number") {
    process.stderr.write("App-server request is missing an ID.\n");
    process.exit(4);
  }

  switch (message.method) {
    case "initialize":
      writeMessage({ id: message.id, result: { serverInfo: { name: "fake-codex" } } });
      return;
    case "mcpServerStatus/list":
      writeMessage({ id: message.id, result: { data: [], nextCursor: null } });
      return;
    case "thread/start":
    case "thread/resume":
      threadSequence += 1;
      writeMessage({
        id: message.id,
        result: { thread: { id: `smoke-thread-${threadSequence}` } },
      });
      return;
    case "turn/start":
      writeMessage({ id: message.id, result: { turn: { id: "smoke-turn" } } });
      writeMessage({
        method: "item/agentMessage/delta",
        params: { itemId: "smoke-message", delta: packagedSmokeResponse },
      });
      writeMessage({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "smoke-message",
            text: packagedSmokeResponse,
          },
        },
      });
      writeMessage({
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            last: {
              inputTokens: 3,
              outputTokens: 4,
              totalTokens: 7,
              cachedInputTokens: 0,
              reasoningOutputTokens: 0,
            },
          },
        },
      });
      writeMessage({ method: "turn/completed", params: { turn: { status: "completed" } } });
      return;
    default:
      writeMessage({
        id: message.id,
        error: { message: `Unsupported app-server method: ${message.method}` },
      });
  }
});
