/** Reconstructs the user's local tool environment for packaged desktop children. */

const { spawn } = require("node:child_process");
const { accessSync, constants, statSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const desktopShellEnvironmentConfig = Object.freeze({
  maximumOutputBytes: 64 * 1_024,
  probeTimeoutMs: 5_000,
  variableNames: Object.freeze([
    "PATH",
    "CODEX_PATH",
    "CLAUDE_PATH",
    "SSH_AUTH_SOCK",
    "HOMEBREW_PREFIX",
    "HOMEBREW_CELLAR",
    "HOMEBREW_REPOSITORY",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
  ]),
});

const environmentNamePattern = /^[A-Z0-9_]+$/u;

function environmentMarker(name, edge) {
  return `__MONTECARLO_ENV_${name}_${edge}__`;
}

function buildEnvironmentCaptureCommand(names) {
  return names
    .map((name) => {
      if (!environmentNamePattern.test(name)) {
        throw new Error(`Unsupported shell environment variable name: ${name}`);
      }
      const readValue =
        name === "CODEX_PATH"
          ? "printenv CODEX_PATH || command -v codex || true"
          : name === "CLAUDE_PATH"
            ? "printenv CLAUDE_PATH || command -v claude || true"
            : `printenv ${name} || true`;
      return [
        `printf '%s\\n' '${environmentMarker(name, "START")}'`,
        readValue,
        `printf '%s\\n' '${environmentMarker(name, "END")}'`,
      ].join("; ");
    })
    .join("; ");
}

function extractEnvironmentValue(output, name) {
  const startMarker = environmentMarker(name, "START");
  const endMarker = environmentMarker(name, "END");
  const startIndex = output.indexOf(startMarker);
  if (startIndex === -1) return undefined;
  const valueStartIndex = startIndex + startMarker.length;
  const endIndex = output.indexOf(endMarker, valueStartIndex);
  if (endIndex === -1) return undefined;
  const value = output
    .slice(valueStartIndex, endIndex)
    .replace(/^\r?\n/u, "")
    .replace(/\r?\n$/u, "");
  return value === "" ? undefined : value;
}

function executeFile(executable, arguments_, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    let outputBytes = 0;
    let settled = false;

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall back to killing the immediate child when process-group cleanup is unavailable.
        }
      }
      child.kill("SIGKILL");
    };
    const finish = (error, releaseChild = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (releaseChild) {
        child.stdout.destroy();
        child.unref();
      }
      if (error === undefined) {
        resolve(output);
      } else {
        if (!releaseChild) {
          child.stdout.destroy();
          child.unref();
        }
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      terminate();
      finish(new Error("The login-shell environment probe timed out."));
    }, options.timeout);

    child.stdout.setEncoding(options.encoding);
    child.stdout.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > options.maxBuffer) {
        terminate();
        finish(new Error("The login-shell environment probe produced too much output."));
        return;
      }
      output += chunk;
      if (options.completionMarker && output.includes(options.completionMarker)) {
        finish(undefined, true);
      }
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`The environment probe exited with ${code ?? signal ?? "unknown"}.`));
    });
  });
}

async function readEnvironmentFromLoginShell(
  shell,
  names = desktopShellEnvironmentConfig.variableNames,
  environment = process.env,
  runFile = executeFile,
) {
  if (names.length === 0) return {};
  const output = await runFile(shell, ["-ilc", buildEnvironmentCaptureCommand(names)], {
    completionMarker: environmentMarker(names.at(-1), "END"),
    encoding: "utf8",
    env: environment,
    maxBuffer: desktopShellEnvironmentConfig.maximumOutputBytes,
    timeout: desktopShellEnvironmentConfig.probeTimeoutMs,
  });
  const captured = {};
  for (const name of names) {
    const value = extractEnvironmentValue(output, name);
    if (value !== undefined) captured[name] = value;
  }
  return captured;
}

async function readPathFromLaunchctl(environment = process.env, runFile = executeFile) {
  try {
    const output = await runFile("/bin/launchctl", ["getenv", "PATH"], {
      encoding: "utf8",
      env: environment,
      maxBuffer: desktopShellEnvironmentConfig.maximumOutputBytes,
      timeout: desktopShellEnvironmentConfig.probeTimeoutMs,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function listLoginShellCandidates(platform, configuredShell, userShell) {
  if (platform === "win32") return [];
  const fallbacks = platform === "darwin" ? ["/bin/zsh", "/bin/bash"] : ["/bin/bash", "/bin/sh"];
  const candidates = [configuredShell, userShell, ...fallbacks]
    .map((candidate) => candidate?.trim())
    .filter(Boolean);
  return [...new Set(candidates)];
}

function mergePathValues(values, platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    for (const entry of value.split(delimiter)) {
      const trimmed = entry.trim();
      const comparison = platform === "win32" ? trimmed.toLowerCase() : trimmed;
      if (trimmed === "" || seen.has(comparison)) continue;
      seen.add(comparison);
      result.push(trimmed);
    }
  }
  return result.length === 0 ? undefined : result.join(delimiter);
}

function knownExecutableDirectories(userHome, platform) {
  if (platform === "win32") return [];
  return [
    path.join(userHome, ".bun", "bin"),
    path.join(userHome, ".local", "bin"),
    path.join(userHome, ".npm", "bin"),
    path.join(userHome, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function isExecutableFile(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveExecutablePath(
  executable,
  environment,
  platform = process.platform,
  executableFileCheck = isExecutableFile,
) {
  const command = executable.trim();
  if (command === "") return undefined;
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return executableFileCheck(command) ? path.resolve(command) : undefined;
  }

  const delimiter = platform === "win32" ? ";" : ":";
  const extensions =
    platform === "win32"
      ? (environment.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((extension) => extension.trim().toLowerCase())
          .filter(Boolean)
      : [""];
  const commandHasExtension = platform === "win32" && path.win32.extname(command) !== "";
  for (const directory of (environment.PATH || "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of commandHasExtension ? [""] : extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (executableFileCheck(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveProviderExecutableEnvironment(
  environment,
  platform = process.platform,
  executableFileCheck = isExecutableFile,
) {
  const resolvedEnvironment = { ...environment };
  for (const [environmentName, defaultExecutable] of [
    ["CODEX_PATH", "codex"],
    ["CLAUDE_PATH", "claude"],
  ]) {
    const configuredExecutable = environment[environmentName]?.trim() || defaultExecutable;
    const resolved = resolveExecutablePath(
      configuredExecutable,
      environment,
      platform,
      executableFileCheck,
    );
    if (resolved !== undefined) resolvedEnvironment[environmentName] = resolved;
  }
  return resolvedEnvironment;
}

function readUserShell() {
  try {
    return os.userInfo().shell;
  } catch {
    return undefined;
  }
}

async function hydrateDesktopEnvironment({
  environment = process.env,
  platform = process.platform,
  userHome = os.homedir(),
  userShell = readUserShell(),
  readShellEnvironment = readEnvironmentFromLoginShell,
  readLaunchctlPath = readPathFromLaunchctl,
  reportDiagnostic = () => {},
  executableFileCheck = isExecutableFile,
} = {}) {
  const hydrated = { ...environment };
  const captured = {};
  let launchctlPath;

  if (platform === "darwin") {
    const candidates = listLoginShellCandidates(platform, environment.SHELL, userShell);
    for (const shell of candidates) {
      try {
        const shellEnvironment = await readShellEnvironment(
          shell,
          desktopShellEnvironmentConfig.variableNames,
          environment,
        );
        for (const [name, value] of Object.entries(shellEnvironment)) {
          if (captured[name] === undefined) captured[name] = value;
        }
        if (captured.PATH !== undefined) break;
      } catch {
        // Try the next compatible shell without exposing shell output or local paths.
      }
    }
    if (captured.PATH === undefined) {
      launchctlPath = await readLaunchctlPath(environment);
      if (launchctlPath === undefined) reportDiagnostic("shell_environment_probe_failed");
    }
  }

  for (const name of desktopShellEnvironmentConfig.variableNames) {
    if (name === "PATH") continue;
    if ((hydrated[name] === undefined || hydrated[name] === "") && captured[name] !== undefined) {
      hydrated[name] = captured[name];
    }
  }
  const mergedPath = mergePathValues(
    [
      captured.PATH,
      launchctlPath,
      knownExecutableDirectories(userHome, platform).join(platform === "win32" ? ";" : ":"),
      hydrated.PATH,
    ],
    platform,
  );
  if (mergedPath !== undefined) hydrated.PATH = mergedPath;
  const localResolutionEnvironment = {
    ...hydrated,
    PATH: knownExecutableDirectories(userHome, platform).join(platform === "win32" ? ";" : ":"),
  };
  const resolvedProviders = resolveProviderExecutableEnvironment(
    localResolutionEnvironment,
    platform,
    executableFileCheck,
  );
  for (const environmentName of ["CODEX_PATH", "CLAUDE_PATH"]) {
    if (resolvedProviders[environmentName] !== undefined) {
      hydrated[environmentName] = resolvedProviders[environmentName];
    }
  }
  return hydrated;
}

module.exports = {
  buildEnvironmentCaptureCommand,
  desktopShellEnvironmentConfig,
  executeFile,
  extractEnvironmentValue,
  hydrateDesktopEnvironment,
  knownExecutableDirectories,
  listLoginShellCandidates,
  mergePathValues,
  readEnvironmentFromLoginShell,
  readPathFromLaunchctl,
  resolveExecutablePath,
  resolveProviderExecutableEnvironment,
};
