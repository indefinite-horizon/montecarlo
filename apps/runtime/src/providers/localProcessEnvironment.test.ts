/** Verifies that provider tooling receives local context without runtime secrets. */

import { describe, expect, it } from "vitest";
import { localToolChildEnvironment } from "./localProcessEnvironment.js";

describe("local provider child environment", () => {
  it("passes toolchain and credential-location context but excludes application secrets", () => {
    expect(
      localToolChildEnvironment(
        {
          HOME: "/Users/example",
          PATH: "/nvm/bin:/usr/bin",
          SSH_AUTH_SOCK: "/tmp/agent.sock",
          HOMEBREW_PREFIX: "/opt/homebrew",
          CLAUDE_CONFIG_DIR: "/Users/example/.claude-work",
          MONTECARLO_RUNTIME_TOKEN: "runtime-secret",
          MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY: "attestation-secret",
          OPENROUTER_API_KEY: "provider-secret",
        },
        ["CLAUDE_CONFIG_DIR"],
      ),
    ).toEqual({
      HOME: "/Users/example",
      PATH: "/nvm/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      HOMEBREW_PREFIX: "/opt/homebrew",
      CLAUDE_CONFIG_DIR: "/Users/example/.claude-work",
    });
  });
});
