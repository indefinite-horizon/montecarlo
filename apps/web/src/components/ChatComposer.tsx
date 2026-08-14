/** Sends prompts to the selected provider and opens prompt-only branches. */

import { ArrowUp, GitBranch, Square, Zap } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId, ReasoningEffort } from "@/lib/conversation";
import { appShortcutLabel, matchesAppShortcut } from "@/lib/keyboardShortcuts";
import type { ProviderModelCatalog, ProviderStatus } from "@/lib/runtimeClient";
import { ActionTooltip } from "./ActionTooltip";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { ThinkingLevelSelector } from "./ThinkingLevelSelector";
import { Button } from "./ui/button";

export const ChatComposer = memo(function ChatComposer({
  disabled = false,
  isStreaming,
  canStop = true,
  onSend,
  onStop,
  onBranch,
  branchDisabled = false,
  provider,
  model,
  providerModels,
  reasoningEffort,
  reasoningEffortOptions,
  fastMode,
  fastModeAvailable,
  onProviderChange,
  onModelChange,
  onEditModel,
  onReasoningEffortChange,
  onFastModeChange,
  onOpenProviderSettings,
  providerModelCatalogs,
  providerModelsLoading,
  providerStatuses,
  providerMenuOpen,
  onProviderMenuOpenChange,
  providerShortcut,
  thinkingShortcut,
}: {
  disabled?: boolean;
  isStreaming: boolean;
  canStop?: boolean;
  onSend: (value: string) => Promise<unknown>;
  onStop: () => void;
  onBranch: () => void;
  branchDisabled?: boolean;
  provider: ProviderId;
  model: string;
  providerModels: Record<ProviderId, string>;
  reasoningEffort: ReasoningEffort;
  reasoningEffortOptions: readonly ReasoningEffort[];
  fastMode: boolean;
  fastModeAvailable: boolean;
  onProviderChange: (value: ProviderId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onEditModel: () => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onFastModeChange: (value: boolean) => void;
  onOpenProviderSettings: () => void;
  providerModelCatalogs: Partial<Record<ProviderId, ProviderModelCatalog>>;
  providerModelsLoading: Partial<Record<ProviderId, boolean>>;
  providerStatuses: Partial<Record<ProviderId, ProviderStatus["health"]["status"]>>;
  providerMenuOpen?: boolean;
  onProviderMenuOpenChange?: (open: boolean) => void;
  providerShortcut?: string;
  thinkingShortcut?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const restoreComposerFocus = useCallback(() => textareaRef.current?.focus(), []);
  const stopShortcut = appShortcutLabel("stopGeneration");

  const submit = () => {
    const prompt = value.trim();
    if (!prompt || isStreaming || disabled || branchDisabled || submittingRef.current) return;
    submittingRef.current = true;
    setValue("");
    void onSend(prompt);
    window.setTimeout(() => {
      submittingRef.current = false;
    }, 0);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-5 pt-12 sm:px-7">
      <div className="pointer-events-auto mx-auto max-w-4xl" data-testid="chat-composer">
        <div className="rounded-2xl border border-input bg-card p-2 shadow-[0_14px_40px_hsl(var(--foreground)/0.09)] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (isStreaming && matchesAppShortcut(event, "stopGeneration")) {
                event.preventDefault();
                if (canStop && !event.repeat && !submittingRef.current) onStop();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            className="max-h-44 min-h-14 w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
            placeholder={t("composer.placeholder")}
          />
          <div className="flex min-w-0 items-center gap-0.5">
            <ProviderSwitcher
              value={provider}
              model={model}
              providerModels={providerModels}
              onChange={onProviderChange}
              onModelChange={onModelChange}
              onEditModel={onEditModel}
              onOpenSettings={onOpenProviderSettings}
              modelCatalogs={providerModelCatalogs}
              modelsLoading={providerModelsLoading}
              providerStatuses={providerStatuses}
              open={providerMenuOpen}
              onOpenChange={onProviderMenuOpenChange}
              onCloseFocus={restoreComposerFocus}
              shortcut={providerShortcut}
            />
            {fastModeAvailable ? (
              <ActionTooltip label={t("composer.fastMode")}>
                <Button
                  data-testid="fast-mode-toggle"
                  className={
                    fastMode
                      ? "gap-1.5 bg-primary/10 px-2.5 text-primary hover:bg-primary/15 hover:text-primary"
                      : "gap-1.5 px-2.5 text-muted-foreground"
                  }
                  variant="ghost"
                  aria-label={t("composer.fastMode")}
                  aria-pressed={fastMode}
                  onClick={() => onFastModeChange(!fastMode)}
                >
                  <Zap className={fastMode ? "fill-current" : undefined} />
                  {fastMode ? <span className="text-xs">{t("composer.fast")}</span> : null}
                </Button>
              </ActionTooltip>
            ) : null}
            {reasoningEffortOptions.some((effort) => effort !== "none") ? (
              <ThinkingLevelSelector
                value={reasoningEffort}
                onChange={onReasoningEffortChange}
                options={reasoningEffortOptions}
                shortcut={thinkingShortcut}
              />
            ) : null}
            <span className="ml-auto" />
            <ActionTooltip label={t("branch.new")}>
              <Button
                className="gap-1.5 px-2.5"
                variant="quiet"
                onClick={onBranch}
                disabled={disabled || branchDisabled}
                aria-label={t("branch.new")}
              >
                <GitBranch />
                <span className="hidden text-xs md:inline">{t("branch.new")}</span>
              </Button>
            </ActionTooltip>
            {isStreaming && canStop ? (
              <ActionTooltip label={t("composer.stop")} shortcut={stopShortcut}>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    if (!submittingRef.current) onStop();
                  }}
                  aria-label={t("composer.stop")}
                >
                  <Square className="fill-current" />
                </Button>
              </ActionTooltip>
            ) : (
              <ActionTooltip label={t("composer.send")}>
                <Button
                  size="icon"
                  onClick={submit}
                  disabled={isStreaming || disabled || branchDisabled || !value.trim()}
                  aria-label={t("composer.send")}
                >
                  <ArrowUp />
                </Button>
              </ActionTooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
