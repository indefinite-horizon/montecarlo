/** Chooses a model provider and model from the composer footer. */

import { Check, ChevronDown, CircleAlert, Pencil, Settings2 } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId, ProviderOption } from "@/lib/conversation";
import { defaultProviderModels } from "@/lib/providerConfig";
import type { ProviderModelCatalog, ProviderStatus } from "@/lib/runtimeClient";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { ProviderIcon } from "./ProviderIcon";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export const ProviderSwitcher = memo(function ProviderSwitcher({
  value,
  model,
  providerModels,
  onChange,
  onModelChange,
  onEditModel,
  onOpenSettings,
  modelCatalogs,
  modelsLoading,
  providerStatuses,
  open: controlledOpen,
  onOpenChange,
  onCloseFocus,
  shortcut,
}: {
  value: ProviderId;
  model: string;
  providerModels: Record<ProviderId, string>;
  onChange: (value: ProviderId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onEditModel: () => void;
  onOpenSettings: () => void;
  modelCatalogs: Partial<Record<ProviderId, ProviderModelCatalog>>;
  modelsLoading: Partial<Record<ProviderId, boolean>>;
  providerStatuses: Partial<Record<ProviderId, ProviderStatus["health"]["status"]>>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseFocus?: () => void;
  shortcut?: string;
}) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const availability = (id: ProviderId): ProviderOption["availability"] => {
    const status = providerStatuses[id];
    if (status === "ready") return "ready";
    if (status === "needs-configuration") return "setup";
    return "blocked";
  };
  const options = [
    {
      id: "codex",
      label: t("providers.codex.name"),
      model: defaultProviderModels.codex,
      detail: t("providers.codex.detail"),
      availability: availability("codex"),
    },
    {
      id: "anthropic",
      label: t("providers.anthropic.name"),
      model: defaultProviderModels.anthropic,
      detail: t("providers.anthropic.detail"),
      availability: availability("anthropic"),
    },
    {
      id: "ollama",
      label: t("providers.ollama.name"),
      model: defaultProviderModels.ollama,
      detail: t("providers.ollama.detail"),
      availability: availability("ollama"),
    },
    {
      id: "openrouter",
      label: t("providers.openrouter.name"),
      model: defaultProviderModels.openrouter,
      detail: t("providers.openrouter.detail"),
      availability: availability("openrouter"),
    },
  ] satisfies [ProviderOption, ...ProviderOption[]];
  const selected = options.find((option) => option.id === value) ?? options[0];
  const triggerModel =
    selected.id !== "openrouter" && selected.availability === "ready" && !modelCatalogs[selected.id]
      ? t("providers.resolvingModels")
      : model;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ActionTooltip label={t("providers.selectModel")} shortcut={shortcut}>
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="provider-trigger"
            className="min-w-0 max-w-64 justify-start gap-1.5 px-2.5"
            variant="ghost"
            aria-label={`${selected.label}, ${triggerModel}. ${t("providers.selectModel")}`}
          >
            <ProviderIcon provider={selected.id} className="size-4 text-foreground" />
            <span className="hidden shrink-0 text-xs sm:inline">{selected.label}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{triggerModel}</span>
            <ChevronDown className="ml-0.5 size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80"
        data-testid="provider-menu"
        onCloseAutoFocus={(event) => {
          if (!onCloseFocus) return;
          event.preventDefault();
          onCloseFocus();
        }}
      >
        <DropdownMenuLabel>{t("providers.choose")}</DropdownMenuLabel>
        {options.map((option) => {
          const ready = option.availability === "ready";
          const catalog = modelCatalogs[option.id];
          const resolving = modelsLoading[option.id] === true;
          const displayedModel =
            option.id !== "openrouter" && ready && !catalog
              ? t("providers.resolvingModels")
              : providerModels[option.id];
          const row = (
            <>
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background">
                <ProviderIcon provider={option.id} className="size-4 text-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  {option.label}
                  {!ready ? <CircleAlert className="size-3 text-amber-600" /> : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {displayedModel} · {option.detail}
                  {!ready
                    ? ` · ${
                        providerStatuses[option.id] === undefined
                          ? t("settings.checking")
                          : option.availability === "setup"
                            ? t("providers.notConfigured")
                            : t("settings.unavailable")
                      }`
                    : ""}
                </span>
              </span>
              {option.id === value ? <Check className="mt-1 size-3.5 text-primary" /> : null}
            </>
          );
          if (!ready || option.id === "openrouter") {
            return (
              <DropdownMenuItem
                key={option.id}
                className={cn("items-start py-2", option.id === value && "bg-accent/70")}
                onSelect={() => onChange(option.id)}
                disabled={!ready}
                aria-current={option.id === value ? "true" : undefined}
                data-testid={`provider-option-${option.id}`}
              >
                {row}
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuSub key={option.id}>
              <DropdownMenuSubTrigger
                className={cn("items-start py-2", option.id === value && "bg-accent/70")}
                aria-current={option.id === value ? "true" : undefined}
                data-testid={`provider-option-${option.id}`}
              >
                {row}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={8}
                alignOffset={-4}
                className="max-h-80 w-72 overflow-y-auto"
                data-testid={`provider-models-${option.id}`}
              >
                <DropdownMenuLabel>{t("providers.chooseModel")}</DropdownMenuLabel>
                {catalog?.models.map((catalogModel) => (
                  <DropdownMenuItem
                    key={catalogModel.id}
                    className="py-2"
                    onSelect={() => onModelChange(option.id, catalogModel.id)}
                    aria-current={
                      catalogModel.id === providerModels[option.id] ? "true" : undefined
                    }
                    data-testid={`provider-model-${option.id}-${catalogModel.id}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {catalogModel.displayName}
                      </span>
                      {catalogModel.displayName !== catalogModel.id ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {catalogModel.id}
                        </span>
                      ) : null}
                    </span>
                    {catalogModel.id === providerModels[option.id] ? (
                      <Check className="size-3.5 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
                {!catalog || catalog.models.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {resolving ? t("providers.loadingModels") : t("providers.noModels")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {value === "openrouter" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onEditModel}
              disabled={selected.availability !== "ready"}
              data-testid="edit-model-option"
            >
              <Pencil />
              <span className="min-w-0 flex-1">
                <span className="block">{t("providers.editModel")}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{model}</span>
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-muted-foreground focus:text-foreground"
          onSelect={onOpenSettings}
          data-testid="manage-providers-option"
        >
          <Settings2 className="size-4" />
          <span className="min-w-0 flex-1">{t("providers.manage")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
