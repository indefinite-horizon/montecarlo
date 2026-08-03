/** Boots the Electron desktop shell and workspace shortcut bridge. */

const { app, BrowserWindow } = require("electron");
const { getAppName } = require("@template/app-constants");
const path = require("node:path");

const isDev = !app.isPackaged;
const appName = getAppName(isDev);

app.setName(appName);

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

  // Intercept Cmd/Ctrl+1..9 before Chrome handles them
  window.webContents.on("before-input-event", (_event, input) => {
    if (
      (input.meta || input.control) &&
      !input.alt &&
      !input.shift &&
      input.type === "keyDown" &&
      input.key >= "1" &&
      input.key <= "9"
    ) {
      const index = Number.parseInt(input.key, 10) - 1;
      window.webContents.send("switch-workspace", index);
      _event.preventDefault();
    }
  });

  if (isDev) {
    // Only accept localhost http(s) URLs to block attacker-controlled origins
    // via a tampered .env.local, postinstall hook, or IDE launch config.
    const rawUrl = process.env.ELECTRON_START_URL || "http://localhost:5173";
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(rawUrl);
    const devUrl = isLocalhost ? rawUrl : "http://localhost:5173";
    window.loadURL(devUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
