/** Collects the optional or required prompt that starts a child branch. */

import { ArrowRight, GitBranch, Quote, X } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BranchAnchor, SelectionAnchor } from "@/lib/conversation";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

export const SelectionBranchAction = memo(function SelectionBranchAction({
  selection,
  onOpen,
}: {
  selection: SelectionAnchor;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const left = Math.max(
    12,
    Math.min(window.innerWidth - 150, selection.rect.left + selection.rect.width / 2 - 62),
  );
  const top = Math.max(12, selection.rect.top - 44);
  return (
    <button
      type="button"
      data-testid="selection-follow-up-action"
      className="fixed z-[70] inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[11px] font-semibold text-background shadow-lg transition-transform hover:-translate-y-px"
      style={{ left, top }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <GitBranch className="size-3.5 text-primary" />
      {t("branch.askFollowUp")}
    </button>
  );
});

export const BranchComposer = memo(function BranchComposer({
  selection,
  onClose,
  onCreate,
}: {
  selection?: SelectionAnchor;
  onClose: () => void;
  onCreate: (anchor: BranchAnchor) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const promptRequired = !selection;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await onCreate({
        sourceMessageId: selection?.messageId,
        selectedText: selection?.sourceText ?? selection?.text,
        displayText: selection?.text,
        selectionStart: selection?.start,
        selectionEnd: selection?.end,
        prompt: prompt.trim(),
      });
      if (created) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end bg-foreground/10 backdrop-blur-[1px]"
      role="presentation"
    >
      <button
        type="button"
        className="min-w-0 flex-1 cursor-default"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <section
        className="flex h-full w-full max-w-md animate-in slide-in-from-right flex-col border-l border-border bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-composer-title"
      >
        <header className="flex h-16 items-center gap-3 border-b border-border px-5">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-primary">
            <GitBranch className="size-4" />
          </span>
          <h2 id="branch-composer-title" className="min-w-0 flex-1 font-display text-lg font-bold">
            {selection ? t("branch.askFollowUp") : t("branch.promptTitle")}
          </h2>
          <ActionTooltip label={t("common.close")} side="left">
            <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("common.close")}>
              <X />
            </Button>
          </ActionTooltip>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {selection ? (
            <div className="mb-5 rounded-lg border border-primary/20 bg-accent/60 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                <Quote className="size-3" />
                {t("branch.selectedPassage")}
              </div>
              <blockquote className="font-display text-[15px] italic leading-6 text-foreground/85">
                “{selection.text}”
              </blockquote>
            </div>
          ) : null}

          <label htmlFor="branch-prompt" className="text-xs font-semibold">
            {promptRequired ? t("branch.promptRequired") : t("branch.promptOptional")}
          </label>
          <textarea
            id="branch-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            className="mt-2 w-full resize-none rounded-lg border border-input bg-card px-3 py-3 text-sm leading-6 outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            placeholder={
              selection ? t("branch.selectionPlaceholder") : t("branch.promptPlaceholder")
            }
          />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || (promptRequired && !prompt.trim())}
          >
            {t("branch.create")}
            <ArrowRight />
          </Button>
        </footer>
      </section>
    </div>
  );
});
