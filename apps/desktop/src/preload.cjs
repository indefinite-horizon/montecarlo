/** Exposes the desktop runtime bridge to the Electron renderer. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("templateDesktop", {
  platform: process.platform,
  onSwitchWorkspace: (callback) => {
    const handler = (_event, index) => callback(index);
    ipcRenderer.on("switch-workspace", handler);
    // Store handler on callback for removal
    callback._ipcHandler = handler;
  },
  offSwitchWorkspace: (callback) => {
    if (callback._ipcHandler) {
      ipcRenderer.removeListener("switch-workspace", callback._ipcHandler);
    }
  },
});
