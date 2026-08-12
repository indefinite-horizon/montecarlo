/** Supervises the pinned, loopback-only Convex backend bundled with the desktop app. */

const { execFile, spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } = require("node:fs");
const { cp, mkdir, rename, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");
const { atomicWritePrivateFile, readSmallFileNoFollow } = require("./desktop-private-files.cjs");
const { loadOrCreateCredentials } = require("./local-convex-credentials.cjs");

const execFileAsync = promisify(execFile);
const stateManifestVersion = 1;
const backendStartupTimeoutMs = 90_000;
const backendHealthPollMs = 250;
const backendStopGraceMs = 5_000;
const maximumStartAttempts = 5;
const instanceName = "montecarlo-local";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function platformKey(platform = process.platform, architecture = process.arch) {
  const normalizedPlatform = platform === "win32" ? "windows" : platform;
  return `${normalizedPlatform}-${architecture}`;
}

function validateBundleManifest(value, key = platformKey()) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.backendRelease !== "string" ||
    value.backendRelease.trim() === "" ||
    !Number.isInteger(value.dataFormatVersion) ||
    value.dataFormatVersion < 1 ||
    value.minimumReadableDataFormatVersion !== value.dataFormatVersion ||
    !isRecord(value.binaries) ||
    typeof value.binaries[key] !== "string" ||
    value.binaries[key].trim() === "" ||
    typeof value.cliEntrypoint !== "string" ||
    typeof value.projectDirectory !== "string"
  ) {
    throw new Error(`The bundled Convex manifest does not support ${key}.`);
  }
  return value;
}

function loadBundle({ resourcesPath, platform = process.platform, architecture = process.arch }) {
  const bundleRoot = path.join(resourcesPath, "convex");
  const rawManifest = readSmallFileNoFollow(
    path.join(bundleRoot, "manifest.json"),
    "Bundled Convex manifest",
    128 * 1_024,
  );
  let parsed;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    throw new Error("The bundled Convex manifest is not valid JSON.");
  }
  const key = platformKey(platform, architecture);
  const manifest = validateBundleManifest(parsed, key);
  const backendPath = path.resolve(bundleRoot, manifest.binaries[key]);
  const cliPath = path.resolve(bundleRoot, manifest.cliEntrypoint);
  const projectPath = path.resolve(bundleRoot, manifest.projectDirectory);
  for (const [label, candidate] of [
    ["backend", backendPath],
    ["CLI", cliPath],
  ]) {
    const relative = path.relative(bundleRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`The bundled Convex ${label} path escapes its resource directory.`);
    }
    const stats = lstatSync(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`The bundled Convex ${label} is not a regular file.`);
    }
  }
  const projectRelative = path.relative(bundleRoot, projectPath);
  if (projectRelative.startsWith("..") || path.isAbsolute(projectRelative)) {
    throw new Error("The bundled Convex project path escapes its resource directory.");
  }
  if (!lstatSync(projectPath).isDirectory()) {
    throw new Error("The bundled Convex project directory is missing.");
  }
  return { backendPath, bundleRoot, cliPath, manifest, projectPath };
}

function readStateManifest(filePath) {
  try {
    const parsed = JSON.parse(
      readSmallFileNoFollow(filePath, "Local data-service state", 128 * 1_024),
    );
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== stateManifestVersion ||
      typeof parsed.appVersion !== "string" ||
      typeof parsed.backendRelease !== "string" ||
      !Number.isInteger(parsed.dataFormatVersion)
    ) {
      throw new Error("Local data-service state has an unsupported format.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertCompatibleState(state, bundleManifest) {
  if (state === undefined) return;
  if (state.dataFormatVersion !== bundleManifest.dataFormatVersion) {
    throw new Error(
      `This version cannot safely open local data format ${state.dataFormatVersion}; ` +
        `it requires ${bundleManifest.dataFormatVersion}.`,
    );
  }
  if (state.backendRelease !== bundleManifest.backendRelease) {
    throw new Error(
      "The bundled Convex backend changed without a tested data migration. The existing data was not opened.",
    );
  }
}

function buildBackendArguments({ backendUrl, credentials, databasePath, siteUrl, storagePath }) {
  const backendPort = new URL(backendUrl).port;
  const sitePort = new URL(siteUrl).port;
  return [
    databasePath,
    "--interface",
    "127.0.0.1",
    "--port",
    backendPort,
    "--site-proxy-port",
    sitePort,
    "--convex-origin",
    backendUrl,
    "--convex-site",
    siteUrl,
    "--instance-name",
    instanceName,
    "--instance-secret",
    credentials.instanceSecret,
    "--local-storage",
    storagePath,
    "--disable-beacon",
    "--redact-logs-to-client",
  ];
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!isRecord(address) || typeof address.port !== "number") {
        server.close(() => reject(new Error("Could not reserve a loopback port.")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function choosePortPair() {
  const backendPort = await reserveLoopbackPort();
  let sitePort = await reserveLoopbackPort();
  while (sitePort === backendPort) sitePort = await reserveLoopbackPort();
  return { backendPort, sitePort };
}

function stopChild(child, signal = "SIGINT", graceMs = backendStopGraceMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (!child.kill("SIGKILL")) finish();
    }, graceMs);
    forceTimer.unref();
    child.once("exit", finish);
    if (!child.kill(signal)) finish();
  });
}

async function waitForHealth({
  child,
  url,
  timeoutMs = backendStartupTimeoutMs,
  fetchImpl = fetch,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The bundled Convex backend exited before becoming ready.");
    }
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Expected while the local backend is starting.
    }
    await delay(backendHealthPollMs);
  }
  throw new Error("Timed out waiting for the bundled Convex backend.");
}

function ensureNodeShim(dataRoot, electronExecutable) {
  const binDirectory = path.join(dataRoot, "bin");
  mkdirSync(binDirectory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const shimPath = path.join(binDirectory, "node.cmd");
    atomicWritePrivateFile(
      shimPath,
      `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${electronExecutable}" %*\r\n`,
    );
    return binDirectory;
  }
  const shimPath = path.join(binDirectory, "node");
  rmSync(shimPath, { force: true });
  symlinkSync(electronExecutable, shimPath);
  return binDirectory;
}

function deploymentEnvironment({ adminKey, backendUrl, binDirectory }) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "CONVEX_DEPLOYMENT" && name !== "CONVEX_DEPLOY_KEY",
    ),
  );
  environment.CONVEX_SELF_HOSTED_URL = backendUrl;
  environment.CONVEX_SELF_HOSTED_ADMIN_KEY = adminKey;
  environment.ELECTRON_RUN_AS_NODE = "1";
  environment.NODE_ENV = "production";
  environment.PATH = [binDirectory, process.env.PATH].filter(Boolean).join(path.delimiter);
  return environment;
}

async function runCli({ args, cliPath, environment, projectPath }) {
  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: projectPath,
      encoding: "utf8",
      env: environment,
      maxBuffer: 8 * 1_024 * 1_024,
      timeout: 5 * 60_000,
      windowsHide: true,
    });
  } catch (error) {
    const exitCode = Number.isInteger(error?.code) ? error.code : "unknown";
    throw new Error(`The bundled Convex deployment command failed (exit ${exitCode}).`);
  }
}

async function generateAdminKey({ backendPath, credentials, dataRoot }) {
  try {
    const result = await execFileAsync(
      backendPath,
      [
        "keygen",
        "admin-key",
        "--instance-name",
        instanceName,
        "--instance-secret",
        credentials.instanceSecret,
      ],
      {
        cwd: dataRoot,
        encoding: "utf8",
        env: { ...process.env, DISABLE_BEACON: "true" },
        maxBuffer: 16 * 1_024,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    const adminKey = result.stdout.trim();
    if (!adminKey.startsWith(`${instanceName}|`) || adminKey.length > 4_096) {
      throw new Error("The bundled backend returned an invalid admin key.");
    }
    return adminKey;
  } catch (error) {
    if (error?.message === "The bundled backend returned an invalid admin key.") throw error;
    throw new Error("The bundled Convex backend could not generate its local admin key.");
  }
}

function convexEnvironmentFile({ credentials, siteUrl }) {
  const values = {
    ALLOW_LOCAL_ANONYMOUS_WORKSPACES: "true",
    ANALYTICS_DISABLED: "true",
    APP_RELEASE_CHANNEL: "desktop-local",
    BETTER_AUTH_SECRET: credentials.betterAuthSecret,
    CONVEX_SITE_URL: siteUrl,
    ENABLE_DANGEROUS_DEV_TOOLS: "false",
    MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY: credentials.attestationPublicKey,
    SITE_URL: siteUrl,
  };
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function deployFunctions({
  adminKey,
  backendUrl,
  binDirectory,
  bundle,
  credentials,
  dataRoot,
  siteUrl,
}) {
  const environment = deploymentEnvironment({ adminKey, backendUrl, binDirectory });
  const environmentPath = path.join(dataRoot, `.convex-env.${process.pid}.tmp`);
  atomicWritePrivateFile(environmentPath, convexEnvironmentFile({ credentials, siteUrl }));
  try {
    await runCli({
      args: ["env", "set", "--from-file", environmentPath, "--force"],
      cliPath: bundle.cliPath,
      environment,
      projectPath: bundle.projectPath,
    });
    // Convex treats CONVEX_URL as a deployment selector in env files, so set
    // the function-visible value explicitly after the bulk environment sync.
    await runCli({
      args: ["env", "set", "CONVEX_URL", backendUrl],
      cliPath: bundle.cliPath,
      environment,
      projectPath: bundle.projectPath,
    });
    await runCli({
      args: [
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--tail-logs",
        "disable",
      ],
      cliPath: bundle.cliPath,
      environment,
      projectPath: bundle.projectPath,
    });
    await runCli({
      args: ["run", "init", "{}"],
      cliPath: bundle.cliPath,
      environment,
      projectPath: bundle.projectPath,
    });
  } finally {
    rmSync(environmentPath, { force: true });
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function replaceDirectory(sourcePath, destinationPath) {
  const oldPath = `${destinationPath}.${process.pid}.old`;
  await rm(oldPath, { recursive: true, force: true });
  if (existsSync(destinationPath)) await rename(destinationPath, oldPath);
  try {
    await rename(sourcePath, destinationPath);
    await rm(oldPath, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destinationPath) && existsSync(oldPath)) await rename(oldPath, destinationPath);
    throw error;
  }
}

async function createRollbackSnapshot({ dataDirectory, manifestPath, rollbackPath }) {
  const temporaryPath = `${rollbackPath}.${process.pid}.tmp`;
  await rm(temporaryPath, { recursive: true, force: true });
  await mkdir(temporaryPath, { recursive: true, mode: 0o700 });
  await cp(dataDirectory, path.join(temporaryPath, "data"), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  if (existsSync(manifestPath)) {
    await cp(manifestPath, path.join(temporaryPath, "state.json"), {
      force: false,
      errorOnExist: true,
    });
  }
  await replaceDirectory(temporaryPath, rollbackPath);
}

async function restoreRollbackSnapshot({ dataDirectory, manifestPath, rollbackPath }) {
  const rollbackDataPath = path.join(rollbackPath, "data");
  if (!existsSync(rollbackDataPath)) throw new Error("The local rollback snapshot is incomplete.");
  const restoredDataPath = `${dataDirectory}.${process.pid}.restore`;
  await rm(restoredDataPath, { recursive: true, force: true });
  await cp(rollbackDataPath, restoredDataPath, { recursive: true, force: false });
  await replaceDirectory(restoredDataPath, dataDirectory);
  const rollbackStatePath = path.join(rollbackPath, "state.json");
  if (existsSync(rollbackStatePath)) {
    await cp(rollbackStatePath, manifestPath, { force: true });
  } else {
    await rm(manifestPath, { force: true });
  }
}

async function recoverInterruptedUpgrade({
  dataDirectory,
  manifestPath,
  pendingPath,
  rollbackPath,
  state,
  storagePath,
}) {
  if (!existsSync(pendingPath)) return state;
  if (existsSync(rollbackPath)) {
    await restoreRollbackSnapshot({ dataDirectory, manifestPath, rollbackPath });
  } else if (state === undefined) {
    await rm(dataDirectory, { recursive: true, force: true });
    await mkdir(storagePath, { recursive: true, mode: 0o700 });
  } else {
    throw new Error("A local data upgrade was interrupted and no rollback snapshot exists.");
  }
  await rm(pendingPath, { force: true });
  return readStateManifest(manifestPath);
}

function createLocalConvexSupervisor({ appVersion, resourcesPath, safeStorage, userDataPath }) {
  const dataRoot = path.join(userDataPath, "convex");
  const credentialPath = path.join(dataRoot, "credentials.v1.json");
  const manifestPath = path.join(dataRoot, "state.json");
  const pendingPath = path.join(dataRoot, "pending-upgrade.json");
  const rollbackPath = path.join(dataRoot, "rollback");
  let backendProcess;
  let currentConfiguration;
  let stoppingPromise;

  async function stop() {
    if (stoppingPromise) return stoppingPromise;
    const child = backendProcess;
    backendProcess = undefined;
    currentConfiguration = undefined;
    stoppingPromise = stopChild(child).finally(() => {
      stoppingPromise = undefined;
    });
    return stoppingPromise;
  }

  async function start() {
    if (currentConfiguration) return currentConfiguration;
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const bundle = loadBundle({ resourcesPath });
    let state = readStateManifest(manifestPath);
    assertCompatibleState(state, bundle.manifest);
    const credentials = loadOrCreateCredentials({ filePath: credentialPath, safeStorage });
    const dataDirectory = path.join(dataRoot, "data", `v${bundle.manifest.dataFormatVersion}`);
    const databasePath = path.join(dataDirectory, "convex.sqlite3");
    const storagePath = path.join(dataDirectory, "storage");
    await mkdir(storagePath, { recursive: true, mode: 0o700 });

    // A prior process may have stopped during a deployment. Restore the exact
    // pre-deployment snapshot before retrying so half-pushed schemas never run.
    if (existsSync(pendingPath)) {
      state = await recoverInterruptedUpgrade({
        dataDirectory,
        manifestPath,
        pendingPath,
        rollbackPath,
        state,
        storagePath,
      });
      assertCompatibleState(state, bundle.manifest);
    }

    const shouldDeploy = state?.appVersion !== appVersion;
    const hadExistingData = existsSync(databasePath);
    if (shouldDeploy) {
      if (hadExistingData) {
        await createRollbackSnapshot({ dataDirectory, manifestPath, rollbackPath });
      }
      await writeJsonAtomic(pendingPath, {
        schemaVersion: 1,
        fromAppVersion: state?.appVersion ?? null,
        toAppVersion: appVersion,
        backendRelease: bundle.manifest.backendRelease,
        dataFormatVersion: bundle.manifest.dataFormatVersion,
      });
    }

    const adminKey = await generateAdminKey({
      backendPath: bundle.backendPath,
      credentials,
      dataRoot,
    });
    const binDirectory = ensureNodeShim(dataRoot, process.execPath);
    let lastError;

    try {
      for (let attempt = 0; attempt < maximumStartAttempts; attempt += 1) {
        const { backendPort, sitePort } = await choosePortPair();
        const backendUrl = `http://127.0.0.1:${backendPort}`;
        const siteUrl = `http://127.0.0.1:${sitePort}`;
        const child = spawn(
          bundle.backendPath,
          buildBackendArguments({
            backendUrl,
            credentials,
            databasePath,
            siteUrl,
            storagePath,
          }),
          {
            cwd: dataDirectory,
            env: {
              ...process.env,
              DISABLE_BEACON: "true",
              ELECTRON_RUN_AS_NODE: "1",
              PATH: [binDirectory, process.env.PATH].filter(Boolean).join(path.delimiter),
            },
            stdio: "ignore",
            windowsHide: true,
          },
        );
        backendProcess = child;
        try {
          await waitForHealth({ child, url: `${backendUrl}/instance_name` });
          currentConfiguration = {
            backendUrl,
            siteUrl,
            runtimeEnvironment: {
              MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY: credentials.attestationPrivateKey,
            },
          };
          break;
        } catch (error) {
          lastError = error;
          await stopChild(child);
          if (backendProcess === child) backendProcess = undefined;
        }
      }
      if (!currentConfiguration)
        throw lastError ?? new Error("The local data service did not start.");

      if (shouldDeploy) {
        await deployFunctions({
          adminKey,
          backendUrl: currentConfiguration.backendUrl,
          binDirectory,
          bundle,
          credentials,
          dataRoot,
          siteUrl: currentConfiguration.siteUrl,
        });
        await waitForHealth({
          child: backendProcess,
          url: `${currentConfiguration.siteUrl}/api/health/ready`,
        });
        await writeJsonAtomic(manifestPath, {
          schemaVersion: stateManifestVersion,
          appVersion,
          backendRelease: bundle.manifest.backendRelease,
          dataFormatVersion: bundle.manifest.dataFormatVersion,
        });
        await rm(pendingPath, { force: true });
      }
      return currentConfiguration;
    } catch (error) {
      await stop();
      if (shouldDeploy) {
        if (hadExistingData && existsSync(rollbackPath)) {
          await restoreRollbackSnapshot({ dataDirectory, manifestPath, rollbackPath });
        } else if (!hadExistingData) {
          await rm(dataDirectory, { recursive: true, force: true });
        }
        await rm(pendingPath, { force: true });
      }
      throw error;
    }
  }

  return Object.freeze({ start, stop });
}

module.exports = {
  assertCompatibleState,
  buildBackendArguments,
  createLocalConvexSupervisor,
  loadOrCreateCredentials,
  platformKey,
  recoverInterruptedUpgrade,
  validateBundleManifest,
};
