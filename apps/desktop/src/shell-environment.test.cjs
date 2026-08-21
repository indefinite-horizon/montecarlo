/** Tests login-shell hydration without reading the test runner's real shell profile. */

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("node:test");
const {
  buildEnvironmentCaptureCommand,
  desktopShellEnvironmentConfig,
  executeFile,
  hydrateDesktopEnvironment,
  listLoginShellCandidates,
  mergePathValues,
  readEnvironmentFromLoginShell,
  resolveExecutablePath,
  resolveProviderExecutableEnvironment,
} = require("./shell-environment.cjs");

function capturedValue(name, value) {
  return [`__MONTECARLO_ENV_${name}_START__`, value, `__MONTECARLO_ENV_${name}_END__`].join("\n");
}

describe("desktop shell environment", () => {
  it("captures allowlisted values through a bounded login-shell probe", async () => {
    let invocation;
    const result = await readEnvironmentFromLoginShell(
      "/bin/zsh",
      ["PATH", "SSH_AUTH_SOCK"],
      { HOME: "/Users/example" },
      async (file, arguments_, options) => {
        invocation = { file, arguments_, options };
        return [
          "profile noise",
          capturedValue("PATH", "/nvm/bin:/usr/bin"),
          capturedValue("SSH_AUTH_SOCK", "/tmp/agent.sock"),
        ].join("\n");
      },
    );

    assert.deepEqual(result, {
      PATH: "/nvm/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    });
    assert.equal(invocation.file, "/bin/zsh");
    assert.deepEqual(invocation.arguments_.slice(0, 1), ["-ilc"]);
    assert.match(invocation.arguments_[1], /printenv PATH/u);
    assert.equal(invocation.options.timeout, desktopShellEnvironmentConfig.probeTimeoutMs);
    assert.equal(invocation.options.maxBuffer, desktopShellEnvironmentConfig.maximumOutputBytes);
    assert.equal(invocation.options.completionMarker, "__MONTECARLO_ENV_SSH_AUTH_SOCK_END__");
    assert.deepEqual(invocation.options.env, { HOME: "/Users/example" });
  });

  it("rejects variable names that could alter the capture command", () => {
    assert.throws(
      () => buildEnvironmentCaptureCommand(["PATH; touch /tmp/example"]),
      /Unsupported shell environment variable name/u,
    );
  });

  it("asks the login shell to resolve provider executables directly", () => {
    const command = buildEnvironmentCaptureCommand(["CODEX_PATH", "CLAUDE_PATH"]);
    assert.match(command, /printenv CODEX_PATH \|\| command -v codex/u);
    assert.match(command, /printenv CLAUDE_PATH \|\| command -v claude/u);
  });

  it("terminates a probe and its process group at the configured deadline", async () => {
    const startedAt = Date.now();
    await assert.rejects(
      executeFile(
        process.execPath,
        [
          "-e",
          'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], { detached: true, stdio: ["ignore", 1, "ignore"] }); child.unref(); setInterval(() => {}, 1_000);',
        ],
        {
          encoding: "utf8",
          env: process.env,
          maxBuffer: 1_024,
          timeout: 50,
        },
      ),
      /timed out/u,
    );
    assert.ok(Date.now() - startedAt < 1_000);
  });

  it("tries configured and account shells before platform fallbacks without duplicates", () => {
    assert.deepEqual(listLoginShellCandidates("darwin", "/opt/homebrew/bin/fish", "/bin/zsh"), [
      "/opt/homebrew/bin/fish",
      "/bin/zsh",
      "/bin/bash",
    ]);
    assert.deepEqual(listLoginShellCandidates("win32", "pwsh.exe", undefined), []);
  });

  it("merges shell, fallback, and inherited PATH entries in precedence order", () => {
    assert.equal(
      mergePathValues(["/nvm/bin:/usr/bin", "/opt/homebrew/bin", "/usr/bin:/bin"], "darwin"),
      "/nvm/bin:/usr/bin:/opt/homebrew/bin:/bin",
    );
    assert.equal(
      mergePathValues(["C:\\Tools;C:\\Windows", "c:\\tools;D:\\Bin"], "win32"),
      "C:\\Tools;C:\\Windows;D:\\Bin",
    );
  });

  it("hydrates once from the first usable shell while preserving explicit values", async () => {
    const attemptedShells = [];
    const executablePaths = new Set([
      "/Users/example/.nvm/versions/node/v24/bin/codex",
      "/Users/example/.local/bin/claude",
    ]);
    const environment = await hydrateDesktopEnvironment({
      environment: {
        HOME: "/Users/example",
        PATH: "/usr/bin:/bin",
        SHELL: "/opt/homebrew/bin/fish",
        SSH_AUTH_SOCK: "/tmp/inherited-agent.sock",
      },
      platform: "darwin",
      userHome: "/Users/example",
      userShell: "/bin/zsh",
      readShellEnvironment: async (shell) => {
        attemptedShells.push(shell);
        if (shell.includes("fish")) throw new Error("unsupported probe");
        return {
          PATH: "/Users/example/.nvm/versions/node/v24/bin:/Users/example/.local/bin:/usr/bin",
          CODEX_PATH: "/Users/example/.nvm/versions/node/v24/bin/codex",
          CLAUDE_PATH: "/Users/example/.local/bin/claude",
          SSH_AUTH_SOCK: "/tmp/shell-agent.sock",
          HOMEBREW_PREFIX: "/opt/homebrew",
        };
      },
      readLaunchctlPath: async () => undefined,
      executableFileCheck: (candidate) => executablePaths.has(candidate),
    });

    assert.deepEqual(attemptedShells, ["/opt/homebrew/bin/fish", "/bin/zsh"]);
    assert.deepEqual(environment.PATH.split(":"), [
      "/Users/example/.nvm/versions/node/v24/bin",
      "/Users/example/.local/bin",
      "/usr/bin",
      "/Users/example/.bun/bin",
      "/Users/example/.npm/bin",
      "/Users/example/.claude/local",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/bin",
    ]);
    assert.equal(environment.SSH_AUTH_SOCK, "/tmp/inherited-agent.sock");
    assert.equal(environment.HOMEBREW_PREFIX, "/opt/homebrew");
    assert.equal(environment.CODEX_PATH, "/Users/example/.nvm/versions/node/v24/bin/codex");
    assert.equal(environment.CLAUDE_PATH, "/Users/example/.local/bin/claude");
  });

  it("falls back to launchctl PATH without making shell failure fatal", async () => {
    let diagnostic;
    const environment = await hydrateDesktopEnvironment({
      environment: { PATH: "/usr/bin", SHELL: "/bin/nu" },
      platform: "darwin",
      userHome: "/Users/example",
      userShell: "/bin/nu",
      readShellEnvironment: async () => {
        throw new Error("unsupported shell");
      },
      readLaunchctlPath: async () => "/mise/shims:/usr/bin",
      reportDiagnostic: (code) => {
        diagnostic = code;
      },
      executableFileCheck: () => false,
    });

    assert.equal(environment.PATH.split(":")[0], "/mise/shims");
    assert.equal(diagnostic, undefined);
  });

  it("resolves defaults and explicit executable paths without invoking a shell", () => {
    const executablePaths = new Set(["/nvm/bin/codex", "/custom/claude"]);
    const check = (candidate) => executablePaths.has(candidate);
    assert.equal(
      resolveExecutablePath("codex", { PATH: "/nvm/bin:/usr/bin" }, "darwin", check),
      "/nvm/bin/codex",
    );
    assert.deepEqual(
      resolveProviderExecutableEnvironment(
        { PATH: "/nvm/bin:/usr/bin", CLAUDE_PATH: "/custom/claude" },
        "darwin",
        check,
      ),
      {
        PATH: "/nvm/bin:/usr/bin",
        CODEX_PATH: "/nvm/bin/codex",
        CLAUDE_PATH: path.resolve("/custom/claude"),
      },
    );
  });
});
