/** Frontend-only provider defaults shared by controller and provider UI. */

import type { ProviderId } from "./conversation";

export const defaultProviderModels = {
  codex: "gpt-5.6-sol",
  anthropic: "sonnet",
  ollama: "qwen3:8b",
  openrouter: "anthropic/claude-sonnet-4.6",
} as const satisfies Record<ProviderId, string>;

function selectedModelStorageKey(provider: ProviderId): string {
  return `monte-carlo:provider:${provider}:selected-model`;
}

export function initialProviderModels(): Record<ProviderId, string> {
  const models: Record<ProviderId, string> = { ...defaultProviderModels };
  try {
    for (const provider of Object.keys(models) as ProviderId[]) {
      const stored = localStorage.getItem(selectedModelStorageKey(provider))?.trim();
      if (stored) models[provider] = stored.slice(0, 256);
    }
  } catch {
    // Browser persistence is optional.
  }
  return models;
}

export function saveSelectedProviderModel(provider: ProviderId, model: string): void {
  try {
    localStorage.setItem(selectedModelStorageKey(provider), model);
  } catch {
    // Browser persistence is optional.
  }
}

export function hasSelectedProviderModel(provider: ProviderId): boolean {
  try {
    return Boolean(localStorage.getItem(selectedModelStorageKey(provider))?.trim());
  } catch {
    return false;
  }
}
