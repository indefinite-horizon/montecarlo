/** Exercises strict provider request and endpoint validation. */

import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config.js";
import { parseChatRequest, resolveOllamaBaseURL, resolveOpenRouterBaseURL } from "./validation.js";

describe("runtime validation", () => {
  it("requires a strong token outside development", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "production" })).toThrow(
      "MONTE_CARLO_RUNTIME_TOKEN",
    );
  });

  it("treats blank optional allowlists as unset", () => {
    const config = loadRuntimeConfig({
      MONTE_CARLO_RUNTIME_DEV: "1",
      MONTE_CARLO_RUNTIME_ALLOWED_ORIGINS: "",
      MONTE_CARLO_RUNTIME_WORKSPACE_IDS: "",
    });

    expect(config.allowedOrigins).toContain("http://localhost:5173");
    expect(config.allowedWorkspaceIds).toBeUndefined();
  });

  it("rejects non-loopback Ollama endpoints and insecure OpenRouter endpoints", () => {
    expect(() => resolveOllamaBaseURL("http://192.168.1.2:11434/v1")).toThrow("localhost");
    expect(() => resolveOpenRouterBaseURL("http://openrouter.ai/api/v1")).toThrow("HTTPS");
  });

  it("does not accept credentials for local subscription providers", () => {
    expect(() =>
      parseChatRequest({
        provider: "codex",
        model: "codex-model",
        messages: [{ role: "user", content: "hello" }],
        connection: { apiKey: "must-not-be-accepted" },
      }),
    ).toThrow("does not accept an API key");
  });

  it("accepts strict reasoning and fast-mode request options", () => {
    const request = parseChatRequest({
      provider: "codex",
      model: "codex-model",
      messages: [{ role: "user", content: "hello" }],
      options: { reasoningEffort: "max", fastMode: true },
    });

    expect(request.options).toEqual({ reasoningEffort: "max", fastMode: true });
    expect(() =>
      parseChatRequest({
        provider: "codex",
        model: "codex-model",
        messages: [{ role: "user", content: "hello" }],
        options: { reasoningEffort: "ultra" },
      }),
    ).toThrow();
    expect(() =>
      parseChatRequest({
        provider: "codex",
        model: "codex-model",
        messages: [{ role: "user", content: "hello" }],
        options: { fastMode: "yes" },
      }),
    ).toThrow();
  });
});
