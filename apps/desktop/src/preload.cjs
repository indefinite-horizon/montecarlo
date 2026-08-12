/** Exposes the desktop runtime bridge to the Electron renderer. */

const { contextBridge, ipcRenderer } = require("electron");

const workspaceSwitchHandlers = new WeakMap();
const newChatHandlers = new WeakMap();
const updateDownloadedHandlers = new WeakMap();

function readLoopbackArgument(name) {
  const prefix = `--${name}=`;
  const rawValue = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!rawValue) return undefined;
  try {
    const url = new URL(rawValue);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.port === ""
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

contextBridge.exposeInMainWorld("monteCarloDesktop", {
  platform: process.platform,
  convexUrl: readLoopbackArgument("montecarlo-convex-url"),
  convexSiteUrl: readLoopbackArgument("montecarlo-convex-site-url"),
  getRuntimeConfig: () => ipcRenderer.invoke("runtime-config"),
  getDesktopInfo: () => ipcRenderer.invoke("desktop-info"),
  getDownloadedUpdate: () => ipcRenderer.invoke("desktop-update:get-downloaded"),
  openUpdateChangelog: () => ipcRenderer.invoke("desktop-update:open-changelog"),
  installDownloadedUpdate: () => ipcRenderer.invoke("desktop-update:install"),
  saveProviderSecret: (provider, secret) => {
    ipcRenderer.send("provider-secret:save", { provider, secret });
  },
  onSwitchWorkspace: (callback) => {
    const existingHandler = workspaceSwitchHandlers.get(callback);
    if (existingHandler) ipcRenderer.removeListener("switch-workspace", existingHandler);
    const handler = (_event, index) => callback(index);
    ipcRenderer.on("switch-workspace", handler);
    workspaceSwitchHandlers.set(callback, handler);
  },
  offSwitchWorkspace: (callback) => {
    const handler = workspaceSwitchHandlers.get(callback);
    if (!handler) return;
    ipcRenderer.removeListener("switch-workspace", handler);
    workspaceSwitchHandlers.delete(callback);
  },
  onNewChat: (callback) => {
    const existingHandler = newChatHandlers.get(callback);
    if (existingHandler) ipcRenderer.removeListener("new-chat", existingHandler);
    const handler = () => callback();
    ipcRenderer.on("new-chat", handler);
    newChatHandlers.set(callback, handler);
  },
  offNewChat: (callback) => {
    const handler = newChatHandlers.get(callback);
    if (!handler) return;
    ipcRenderer.removeListener("new-chat", handler);
    newChatHandlers.delete(callback);
  },
  onUpdateDownloaded: (callback) => {
    const existingHandler = updateDownloadedHandlers.get(callback);
    if (existingHandler) {
      ipcRenderer.removeListener("desktop-update:downloaded", existingHandler);
    }
    const handler = (_event, update) => callback(update);
    ipcRenderer.on("desktop-update:downloaded", handler);
    updateDownloadedHandlers.set(callback, handler);
  },
  offUpdateDownloaded: (callback) => {
    const handler = updateDownloadedHandlers.get(callback);
    if (!handler) return;
    ipcRenderer.removeListener("desktop-update:downloaded", handler);
    updateDownloadedHandlers.delete(callback);
  },
});
