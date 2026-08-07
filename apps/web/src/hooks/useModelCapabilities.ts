/** Keeps composer controls compatible with the selected runtime model. */

import { useEffect, useMemo } from "react";
import {
  fallbackReasoningEfforts,
  type ProviderId,
  type ReasoningEffort,
  userReasoningEfforts,
} from "@/lib/conversation";
import type { ProviderModelCatalog } from "@/lib/runtimeClient";

export function useModelCapabilities({
  catalogs,
  fastMode,
  model,
  onFastModeChange,
  onReasoningEffortChange,
  provider,
  reasoningEffort,
}: {
  catalogs: Partial<Record<ProviderId, ProviderModelCatalog>>;
  fastMode: boolean;
  model: string;
  onFastModeChange: (value: boolean) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  provider: ProviderId;
  reasoningEffort: ReasoningEffort;
}) {
  const selectedModel = useMemo(
    () => catalogs[provider]?.models.find((candidate) => candidate.id === model),
    [catalogs, model, provider],
  );
  const availableReasoningEfforts = useMemo<readonly ReasoningEffort[]>(() => {
    if (!selectedModel?.reasoningEfforts) return fallbackReasoningEfforts;
    return userReasoningEfforts.filter(
      (effort) => effort === "none" || selectedModel.reasoningEfforts?.includes(effort),
    );
  }, [selectedModel]);
  const fastModeAvailable =
    provider === "codex" &&
    (catalogs.codex === undefined || selectedModel?.supportsFastMode === true);

  // lint-allow: no-direct-use-effect — provider catalogs constrain valid composer settings.
  useEffect(() => {
    if (fastMode && !fastModeAvailable) onFastModeChange(false);
    if (availableReasoningEfforts.includes(reasoningEffort)) return;
    const fallback = availableReasoningEfforts.includes("medium")
      ? "medium"
      : (availableReasoningEfforts[0] ?? "none");
    onReasoningEffortChange(fallback);
  }, [
    availableReasoningEfforts,
    fastMode,
    fastModeAvailable,
    onFastModeChange,
    onReasoningEffortChange,
    reasoningEffort,
  ]);

  return { availableReasoningEfforts, fastModeAvailable };
}
