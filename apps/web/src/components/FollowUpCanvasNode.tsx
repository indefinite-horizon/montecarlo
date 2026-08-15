/** Canvas composer node for creating a follow-up branch. */

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SelectionAnchor } from "@/lib/conversation";
import { Button } from "./ui/button";

export type FollowUpCanvasNodeData = {
  selection?: SelectionAnchor;
  onCancel: () => void;
  onSubmit: (prompt: string) => Promise<void>;
};

export type FollowUpComposerNode = Node<FollowUpCanvasNodeData, "composer">;

export const FollowUpCanvasNode = memo(function FollowUpCanvasNode({
  data,
}: NodeProps<FollowUpComposerNode>) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRequired = !data.selection;

  // lint-allow: no-direct-use-effect — the newly mounted canvas dialog owns focus.
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  const submit = async () => {
    const value = prompt.trim();
    if ((promptRequired && !value) || submitting) return;
    setSubmitting(true);
    try {
      await data.onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      role="dialog"
      aria-labelledby="canvas-follow-up-title"
      className="flex h-full w-full flex-col overflow-hidden rounded-[18px] border border-primary/45 bg-card shadow-[0_20px_64px_hsl(var(--foreground)/0.14)]"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-branch-blue"
      />
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-primary" />
        <h2 id="canvas-follow-up-title" className="font-display text-sm font-bold">
          {t("branch.askFollowUp")}
        </h2>
      </header>
      {data.selection ? (
        <blockquote className="mx-3 mt-3 line-clamp-2 rounded-md bg-accent/55 px-3 py-2 font-display text-[11px] italic leading-4 text-foreground/75">
          “{data.selection.text}”
        </blockquote>
      ) : null}
      <label htmlFor="canvas-follow-up-prompt" className="sr-only">
        {t("canvas.promptLabel")}
      </label>
      <textarea
        ref={promptRef}
        id="canvas-follow-up-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            data.onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={4}
        className="nodrag nopan nowheel mx-3 mt-3 min-h-0 flex-1 resize-none rounded-lg border border-input bg-background/55 px-3 py-2.5 text-[12px] leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
        placeholder={t("canvas.promptPlaceholder")}
      />
      <footer className="flex gap-2 p-3">
        <Button className="nodrag nopan flex-1" size="sm" variant="ghost" onClick={data.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          className="nodrag nopan flex-1"
          size="sm"
          disabled={(promptRequired && !prompt.trim()) || submitting}
          onClick={() => void submit()}
        >
          {submitting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {t("canvas.ask")}
        </Button>
      </footer>
    </section>
  );
});
