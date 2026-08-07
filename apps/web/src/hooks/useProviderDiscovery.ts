/** Loads provider health and cache-then-refresh model catalogs from the local runtime. */

import { useCallback, useRef, useState } from "react";
import type { ProviderId } from "@/lib/conversation";
import { hasSelectedProviderModel } from "@/lib/providerConfig";
import {
  getCachedModelCatalog,
  getProviderEndpoint,
  getRuntimeModelCatalog,
  getRuntimeProviders,
  type ProviderModelCatalog,
  type ProviderStatus,
} from "@/lib/runtimeClient";
import { useMountEffect } from "./useMountEffect";

function cachedModelCatalogs(): Partial<Record<ProviderId, ProviderModelCatalog>> {
  return {
    codex: getCachedModelCatalog("codex"),
    anthropic: getCachedModelCatalog("anthropic"),
    ollama: getCachedModelCatalog("ollama", getProviderEndpoint("ollama") || undefined),
  };
}

export function useProviderDiscovery(
  onDefaultModel: (provider: ProviderId, model: string) => void,
) {
  const [statuses, setStatuses] = useState<
    Partial<Record<ProviderId, ProviderStatus["health"]["status"]>>
  >({});
  const [catalogs, setCatalogs] = useState(cachedModelCatalogs);
  const [loadingProviders, setLoadingProviders] = useState<Partial<Record<ProviderId, boolean>>>(
    {},
  );
  const inFlightRef = useRef(
    new Map<Exclude<ProviderId, "openrouter">, Promise<ProviderModelCatalog | undefined>>(),
  );

  const refreshModels = useCallback(
    (provider: ProviderId) => {
      if (provider === "openrouter") return;
      const existing = inFlightRef.current.get(provider);
      if (existing) return existing;
      setLoadingProviders((current) => ({ ...current, [provider]: true }));
      const request = (async () => {
        try {
          const connectionBaseURL =
            provider === "ollama" ? getProviderEndpoint("ollama") || undefined : undefined;
          const catalog = await getRuntimeModelCatalog(provider, connectionBaseURL);
          setCatalogs((current) => ({ ...current, [provider]: catalog }));
          const firstModel = catalog.models[0]?.id;
          if (firstModel && !hasSelectedProviderModel(provider)) {
            onDefaultModel(provider, firstModel);
          }
          return catalog;
        } catch {
          // Keep a stale catalog visible when refresh fails.
          return undefined;
        } finally {
          inFlightRef.current.delete(provider);
          setLoadingProviders((current) => ({ ...current, [provider]: false }));
        }
      })();
      inFlightRef.current.set(provider, request);
      return request;
    },
    [onDefaultModel],
  );

  const refreshStatuses = useCallback(async () => {
    try {
      const providers = await getRuntimeProviders();
      setStatuses(
        Object.fromEntries(
          providers.map((provider) => [provider.id, provider.health.status]),
        ) as Partial<Record<ProviderId, ProviderStatus["health"]["status"]>>,
      );
      for (const provider of providers) {
        if (provider.health.status === "ready" && provider.id !== "openrouter") {
          void refreshModels(provider.id as ProviderId);
        }
      }
    } catch {
      setStatuses({});
    }
  }, [refreshModels]);

  useMountEffect(() => {
    for (const [provider, catalog] of Object.entries(catalogs) as Array<
      [ProviderId, ProviderModelCatalog | undefined]
    >) {
      if (!catalog) continue;
      const firstModel = catalog.models[0]?.id;
      if (firstModel && !hasSelectedProviderModel(provider)) {
        onDefaultModel(provider, firstModel);
      }
    }
    void refreshStatuses();
  });

  return { catalogs, loadingProviders, refreshModels, refreshStatuses, statuses };
}
