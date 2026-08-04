/** Sends prompts to the selected provider and opens prompt-only branches. */

import { ArrowUp, GitBranch, Square } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

export const ChatComposer = memo(function ChatComposer({
  disabled = false,
  isStreaming,
  onSend,
  onStop,
  onBranch,
}: {
  disabled?: boolean;
  isStreaming: boolean;
  onSend: (value: string) => Promise<void>;
  onStop: () => void;
  onBranch: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  const submit = () => {
    const prompt = value.trim();
    if (!prompt || isStreaming || disabled) return;
    setValue("");
    void onSend(prompt);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-5 pt-12 sm:px-7">
      <div className="pointer-events-auto mx-auto max-w-3xl">
        <div className="rounded-2xl border border-input bg-card p-2 shadow-[0_14px_40px_hsl(var(--foreground)/0.09)] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            disabled={disabled}
            className="max-h-44 min-h-14 w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
            placeholder={t("composer.placeholder")}
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={onBranch} disabled={disabled}>
              <GitBranch />
              <span className="hidden sm:inline">{t("branch.new")}</span>
            </Button>
            <span className="ml-auto" />
            {isStreaming ? (
              <Button
                size="icon"
                variant="outline"
                onClick={onStop}
                aria-label={t("composer.stop")}
              >
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={submit}
                disabled={disabled || !value.trim()}
                aria-label={t("composer.send")}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
