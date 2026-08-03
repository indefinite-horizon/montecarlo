/** Boots the hardened Electron shell and its authenticated local runtime. */

const { app, BrowserWindow, ipcMain, protocol, safeStorage, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const {
  desktopOrigin,
  isAllowedExternalUrl,
  isAllowedRendererUrl,
  parseRuntimeReadyLine,
  readRuntimePort,
  resolveDevelopmentRendererUrl,
  resolveRendererAsset,
} = require("./desktop-security.cjs");
const { createProviderSecretStore, parseProviderSecretUpdate } = require("./provider-secrets.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const isDevelopment = !app.isPackaged;
const appName = isDevelopment ? "Monte Carlo (Dev)" : "Monte Carlo";
const developmentRendererUrl = resolveDevelopmentRendererUrl(process.env.ELECTRON_START_URL);
const rendererOrigin = isDevelopment ? new URL(developmentRendererUrl).origin : desktopOrigin;
// Port zero lets the child bind an OS-assigned socket that another process
// cannot pre-claim before the renderer receives its authenticated address.
const runtimePort = readRuntimePort(process.env.MONTE_CARLO_RUNTIME_PORT ?? "0");
const runtimeToken = randomBytes(32).toString("base64url");
const expectedRuntimeStops = new WeakSet();
const runtimeStopGraceMs = 2_000;
let isQuitting = false;
let providerSecretStore;
let runtimeProcess;
let runtimeReadyPromise;
let rejectRuntimeReady;
let secretSaveQueue = Promise.resolve();

app.setName(appName);

function writeDiagnostic(code, detail) {
  process.stderr.write(`${JSON.stringify({ source: "desktop", code, detail })}\n`);
}

function runtimeEntrypoint() {
  if (isDevelopment) return path.resolve(__dirname, "../../runtime/src/index.ts");
  return path.join(process.resourcesPath, "runtime", "runtime.cjs");
}

function workspaceRoot() {
  return path.join(app.getPath("userData"), "workspaces");
}

function runtimeExecutablePath() {
  const userHome = app.getPath("home");
  const candidates = [
    path.join(userHome, ".bun", "bin"),
    path.join(userHome, ".local", "bin"),
    path.join(userHome, ".npm", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH || "").split(path.delimiter),
  ];
  return [...new Set(candidates.filter(Boolean))].join(path.delimiter);
}

function startRuntime() {
  if (runtimeProcess !== undefined && runtimeReadyPromise !== undefined) return runtimeReadyPromise;
  const executable = isDevelopment ? process.env.BUN_EXECUTABLE || "bun" : process.execPath;
  const entrypoint = runtimeEntrypoint();
  const args = isDevelopment ? ["run", entrypoint] : [entrypoint];
  const workspacesDirectory = workspaceRoot();
  mkdirSync(workspacesDirectory, { recursive: true, mode: 0o700 });
  const providerEnvironment = providerSecretStore?.loadEnvironment() ?? {};

  let settleReady;
  const readyPromise = new Promise((resolve, reject) => {
    settleReady = resolve;
    rejectRuntimeReady = reject;
  });
  // Attach a rejection handler immediately; IPC callers still receive the
  // original promise and its failure when they request runtime configuration.
  void readyPromise.catch(() => {});
  runtimeReadyPromise = readyPromise;

  const child = spawn(executable, args, {
    cwd: isDevelopment ? path.resolve(__dirname, "../../..") : app.getPath("userData"),
    env: {
      ...process.env,
      ...providerEnvironment,
      PATH: runtimeExecutablePath(),
      ...(isDevelopment ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
      MONTE_CARLO_RUNTIME_ALLOWED_ORIGINS: rendererOrigin,
      MONTE_CARLO_RUNTIME_DEV: isDevelopment ? "1" : "0",
      MONTE_CARLO_RUNTIME_HOST: "127.0.0.1",
      MONTE_CARLO_RUNTIME_PORT: String(runtimePort),
      MONTE_CARLO_RUNTIME_TOKEN: runtimeToken,
      MONTE_CARLO_WORKSPACES_DIR: workspacesDirectory,
      NODE_ENV: isDevelopment ? process.env.NODE_ENV || "development" : "production",
    },
    stdio: ["ignore", "pipe", isDevelopment ? "inherit" : "ignore"],
  });
  runtimeProcess = child;
  let outputBuffer = "";
  let ready = false;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (isDevelopment) process.stdout.write(chunk);
    outputBuffer += chunk;
    const lines = outputBuffer.split(/\r?\n/u);
    outputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const address = parseRuntimeReadyLine(line);
      if (!address || ready) continue;
      ready = true;
      settleReady({ baseUrl: address.baseUrl, token: runtimeToken });
    }
  });

  const rejectBeforeReady = () => {
    if (ready) return;
    rejectRuntimeReady?.(new Error("The local runtime exited before it became ready."));
  };

  child.once("error", () => {
    rejectBeforeReady();
    if (runtimeProcess === child) runtimeProcess = undefined;
    if (!isQuitting && !expectedRuntimeStops.has(child)) {
      writeDiagnostic("runtime_spawn_failed", "The local runtime process could not start.");
    }
  });
  child.once("exit", (code, signal) => {
    rejectBeforeReady();
    if (runtimeProcess === child) runtimeProcess = undefined;
    if (!isQuitting && !expectedRuntimeStops.has(child)) {
      writeDiagnostic("runtime_exited", { code: code ?? -1, signal: signal ?? "unknown" });
    }
  });
  return readyPromise;
}

function stopRuntime() {
  const child = runtimeProcess;
  runtimeProcess = undefined;
  runtimeReadyPromise = undefined;
  rejectRuntimeReady?.(new Error("The local runtime stopped."));
  rejectRuntimeReady = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  expectedRuntimeStops.add(child);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      resolve();
    };
    const forceKillTimer = setTimeout(() => {
      if (!child.kill("SIGKILL")) finish();
    }, runtimeStopGraceMs);
    forceKillTimer.unref();
    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
  });
}

async function restartRuntime() {
  await stopRuntime();
  if (!isQuitting) await startRuntime();
}

function getRuntimeConfig() {
  return runtimeReadyPromise ?? startRuntime();
}

function isTrustedRendererUrl(target) {
  return isAllowedRendererUrl(target, isDevelopment, rendererOrigin);
}

function assertTrustedIpcSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl)) throw new Error("Rejected IPC from an untrusted renderer.");
}

function rendererResponse(status, body, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleRendererRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return rendererResponse(405, "Method Not Allowed");
  }
  const rendererRoot = path.join(process.resourcesPath, "renderer");
  const asset = resolveRendererAsset(rendererRoot, request.url);
  if (asset === null) return rendererResponse(404, "Not Found");
  try {
    const body = request.method === "HEAD" ? null : await readFile(asset.filePath);
    return rendererResponse(200, body, asset.mimeType);
  } catch {
    return rendererResponse(404, "Not Found");
  }
}

function registerIpcHandlers() {
  ipcMain.handle("runtime-config", (event) => {
    assertTrustedIpcSender(event);
    return getRuntimeConfig();
  });
  ipcMain.handle("desktop-info", (event) => {
    assertTrustedIpcSender(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
      workspaceRoot: workspaceRoot(),
    };
  });
  ipcMain.on("provider-secret:save", (event, rawUpdate) => {
    let update;
    try {
      assertTrustedIpcSender(event);
      update = parseProviderSecretUpdate(rawUpdate);
    } catch {
      writeDiagnostic("provider_secret_rejected", "The provider credential update was invalid.");
      return;
    }
    secretSaveQueue = secretSaveQueue
      .then(async () => {
        providerSecretStore.save(update);
        await restartRuntime();
      })
      .catch(() => {
        writeDiagnostic("provider_secret_save_failed", "The provider credential was not saved.");
      });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: appName,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (
      (input.meta || input.control) &&
      !input.alt &&
      !input.shift &&
      input.type === "keyDown" &&
      input.key >= "1" &&
      input.key <= "9"
    ) {
      window.webContents.send("switch-workspace", Number.parseInt(input.key, 10) - 1);
      event.preventDefault();
    }
  });

  if (isDevelopment) {
    void window.loadURL(developmentRendererUrl);
    if (process.env.MONTE_CARLO_OPEN_DEVTOOLS === "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void window.loadURL(`${desktopOrigin}/`);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];
    if (!existingWindow) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.focus();
  });

  app.whenReady().then(async () => {
    providerSecretStore = createProviderSecretStore({
      safeStorage,
      userDataPath: app.getPath("userData"),
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    if (!isDevelopment) await protocol.handle("app", handleRendererRequest);
    registerIpcHandlers();
    void startRuntime().catch(() => {
      writeDiagnostic("runtime_not_ready", "The local runtime did not become ready.");
    });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    void stopRuntime();
  });
}
