/** Declares the narrow Electron preload API available to the sandboxed renderer. */

export type DesktopProviderSecretId = "openrouter";

export interface DesktopDownloadedUpdate {
  version: string;
  releaseDate?: string;
}

export interface MonteCarloDesktopBridge {
  platform: string;
  convexUrl?: string;
  convexSiteUrl?: string;
  getRuntimeConfig(): Promise<{ baseUrl: string; token: string }>;
  getDesktopInfo(): Promise<{ platform: string; version: string; workspaceRoot: string }>;
  saveProviderSecret(provider: DesktopProviderSecretId, secret: string): void;
  onSwitchWorkspace(callback: (index: number) => void): void;
  offSwitchWorkspace(callback: (index: number) => void): void;
  onNewChat(callback: () => void): void;
  offNewChat(callback: () => void): void;
  getDownloadedUpdate(): Promise<DesktopDownloadedUpdate | undefined>;
  onUpdateDownloaded(callback: (update: DesktopDownloadedUpdate) => void): void;
  offUpdateDownloaded(callback: (update: DesktopDownloadedUpdate) => void): void;
  openUpdateChangelog(): Promise<void>;
  installDownloadedUpdate(): Promise<void>;
}

declare global {
  interface Window {
    monteCarloDesktop?: MonteCarloDesktopBridge;
  }
}
