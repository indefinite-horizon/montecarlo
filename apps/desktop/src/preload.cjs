/** Exposes the desktop runtime bridge to the Electron renderer. */

const { contextBridge, ipcRenderer } = require("electron");

const workspaceSwitchHandlers = new WeakMap();
const newChatHandlers = new WeakMap();

contextBridge.exposeInMainWorld("monteCarloDesktop", {
  platform: process.platform,
  getRuntimeConfig: () => ipcRenderer.invoke("runtime-config"),
  getDesktopInfo: () => ipcRenderer.invoke("desktop-info"),
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
});
