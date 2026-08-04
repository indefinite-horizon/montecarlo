/** Chooses a local harness or model provider without changing chat persistence. */

import {
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  Route,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId, ProviderOption } from "@/lib/conversation";
import { defaultProviderModels } from "@/lib/providerConfig";
import { cn } from "@/lib/utils";

const iconByProvider = {
  codex: SquareTerminal,
  anthropic: Sparkles,
  ollama: Cpu,
  openrouter: Route,
} satisfies Record<ProviderId, typeof Cpu>;

export const ProviderSwitcher = memo(function ProviderSwitcher({
  value,
  model,
  onChange,
  onModelChange,
  onOpenSettings,
}: {
  value: ProviderId;
  model: string;
  onChange: (value: ProviderId) => void;
  onModelChange: (value: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const options = [
    {
      id: "codex",
      label: t("providers.codex.name"),
      model: defaultProviderModels.codex,
      detail: t("providers.codex.detail"),
      availability: "ready",
    },
    {
      id: "openrouter",
      label: t("providers.openrouter.name"),
      model: defaultProviderModels.openrouter,
      detail: t("providers.openrouter.detail"),
      availability: "setup",
    },
    {
      id: "ollama",
      label: t("providers.ollama.name"),
      model: defaultProviderModels.ollama,
      detail: t("providers.ollama.detail"),
      availability: "ready",
    },
    {
      id: "anthropic",
      label: t("providers.anthropic.name"),
      model: defaultProviderModels.anthropic,
      detail: t("providers.anthropic.detail"),
      availability: "setup",
    },
  ] satisfies [ProviderOption, ...ProviderOption[]];
  const selected = options.find((option) => option.id === value) ?? options[0];
  const SelectedIcon = iconByProvider[selected.id];

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="provider-trigger"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <SelectedIcon className="size-3.5 text-primary" />
        <span className="hidden sm:inline">{selected.label}</span>
        <span className="max-w-32 truncate text-muted-foreground">{model}</span>
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-lg border border-border bg-popover p-1.5 shadow-xl"
          data-testid="provider-menu"
        >
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("providers.choose")}
          </p>
          {options.map((option) => {
            const Icon = iconByProvider[option.id];
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent",
                  option.id === value && "bg-accent/70",
                )}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background">
                  <Icon className="size-3.5 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {option.label}
                    {option.availability === "setup" ? (
                      <CircleAlert className="size-3 text-amber-600" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {option.id === value ? model : option.model} · {option.detail}
                  </span>
                </span>
                {option.id === value ? <Check className="mt-1 size-3.5 text-primary" /> : null}
              </button>
            );
          })}
          <label className="mt-1 block border-t border-border px-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {t("providers.modelId")}
            <input
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              className="mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus:border-ring"
              maxLength={256}
            />
          </label>
          <button
            type="button"
            className="mt-1 w-full px-2 pb-1 pt-2 text-left text-[11px] font-medium text-primary hover:underline"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            {t("providers.manage")}
          </button>
        </div>
      ) : null}
    </div>
  );
});
