/** Declares the narrow Electron preload API available to the sandboxed renderer. */

export type DesktopProviderSecretId = "anthropic" | "openrouter";

export interface MonteCarloDesktopBridge {
  platform: string;
  getRuntimeConfig(): Promise<{ baseUrl: string; token: string }>;
  getDesktopInfo(): Promise<{ platform: string; version: string; workspaceRoot: string }>;
  saveProviderSecret(provider: DesktopProviderSecretId, secret: string): void;
  onSwitchWorkspace(callback: (index: number) => void): void;
  offSwitchWorkspace(callback: (index: number) => void): void;
}

declare global {
  interface Window {
    monteCarloDesktop?: MonteCarloDesktopBridge;
  }
}
