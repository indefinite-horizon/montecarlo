/** Selects a discovered provider model or edits OpenRouter's custom model ID. */

import { Check, Search } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId } from "@/lib/conversation";
import type { ProviderModel } from "@/lib/runtimeClient";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export const ModelEditDialog = memo(function ModelEditDialog({
  open,
  provider,
  model,
  models,
  loading,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  provider: ProviderId;
  model: string;
  models: ProviderModel[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (model: string) => void;
}) {
  if (!open) return null;
  return (
    <OpenModelEditDialog
      provider={provider}
      model={model}
      models={models}
      loading={loading}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
});

function OpenModelEditDialog({
  provider,
  model,
  models,
  loading,
  onOpenChange,
  onSave,
}: {
  provider: ProviderId;
  model: string;
  models: ProviderModel[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (model: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(model);
  const [query, setQuery] = useState("");
  const customModel = provider === "openrouter";
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return models;
    return models.filter((option) =>
      `${option.displayName}\n${option.id}`.toLocaleLowerCase().includes(normalized),
    );
  }, [models, query]);

  const submit = () => {
    const normalized = draft.trim();
    if (!normalized) return;
    onSave(normalized);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (customModel) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {customModel ? t("providers.editModel") : t("providers.chooseModel")}
            </DialogTitle>
          </DialogHeader>
          {customModel ? (
            <>
              <div className="grid gap-2">
                <label htmlFor="provider-model-id" className="text-xs font-semibold">
                  {t("providers.modelId")}
                </label>
                <Input
                  id="provider-model-id"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                  maxLength={256}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!draft.trim()}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <label htmlFor="provider-model-search" className="relative block">
                <span className="sr-only">{t("providers.searchModels")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="provider-model-search"
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("providers.searchModels")}
                  autoFocus
                />
              </label>
              <div
                className="max-h-80 overflow-y-auto rounded-lg border border-border p-1"
                role="listbox"
              >
                {filteredModels.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === model}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      option.id === model && "bg-accent/70",
                    )}
                    onClick={() => {
                      onSave(option.id);
                      onOpenChange(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{option.displayName}</span>
                      {option.displayName !== option.id ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.id}
                        </span>
                      ) : null}
                    </span>
                    {option.id === model ? <Check className="size-4 text-primary" /> : null}
                  </button>
                ))}
                {filteredModels.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
                    {loading ? t("providers.loadingModels") : t("providers.noModels")}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
