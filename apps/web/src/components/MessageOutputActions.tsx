/** Hover and focus actions shown beneath a completed assistant output. */

import { Check, Clock3, Copy, Pencil, RotateCcw } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { ChatMessage } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { ProviderIcon } from "./ProviderIcon";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeDate(createdAt: number, locale: string, now = Date.now()) {
  const elapsed = createdAt - now;
  const absoluteElapsed = Math.abs(elapsed);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (absoluteElapsed < MINUTE) return formatter.format(0, "second");
  if (absoluteElapsed < HOUR) return formatter.format(Math.round(elapsed / MINUTE), "minute");
  if (absoluteElapsed < DAY) return formatter.format(Math.round(elapsed / HOUR), "hour");
  if (absoluteElapsed < MONTH) return formatter.format(Math.round(elapsed / DAY), "day");
  if (absoluteElapsed < YEAR) return formatter.format(Math.round(elapsed / MONTH), "month");
  return formatter.format(Math.round(elapsed / YEAR), "year");
}

export function formatFullDate(createdAt: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(createdAt);
}

export const MessageOutputActions = memo(function MessageOutputActions({
  actionsDisabled = false,
  className,
  message,
  onEdit,
  onRetry,
}: {
  actionsDisabled?: boolean;
  className?: string;
  message: ChatMessage;
  onEdit?: (content: string) => Promise<boolean>;
  onRetry?: () => Promise<boolean>;
}) {
  const { i18n, t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [submitting, setSubmitting] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const relativeDate = formatRelativeDate(message.createdAt, locale);
  const fullDate = formatFullDate(message.createdAt, locale);

  const copyOutput = async () => {
    try {
      await copyText(message.content);
      setCopied(true);
      toast.success(t("chat.outputCopied"));
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error(t("chat.outputCopyError"));
    }
  };

  const submitEdit = async () => {
    const content = draft.trim();
    if (!onEdit || !content || content === message.content.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onEdit(content)) setEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  const timestamp = (
    <ActionTooltip label={fullDate}>
      <time
        className="flex h-7 items-center gap-1 px-1.5"
        dateTime={new Date(message.createdAt).toISOString()}
      >
        <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only">{t("chat.outputDate", { date: fullDate })}</span>
        <span aria-hidden="true">{relativeDate}</span>
      </time>
    </ActionTooltip>
  );

  return (
    <div
      data-testid="message-output-actions"
      className={cn(
        "mt-2 flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/output:opacity-100 group-focus-within/output:opacity-100",
        className,
      )}
    >
      {message.role === "user" ? timestamp : null}
      {message.model ? (
        <span className="flex h-7 min-w-0 items-center gap-1 px-1.5" data-testid="message-model">
          {message.provider ? (
            <ProviderIcon className="size-3.5 shrink-0" provider={message.provider} />
          ) : null}
          <span className="max-w-48 truncate">{message.model}</span>
        </span>
      ) : null}
      {onRetry ? (
        <ActionTooltip label={t("chat.retryMessage")}>
          <Button
            aria-label={t("chat.retryMessage")}
            className="size-7 p-0 text-muted-foreground hover:text-foreground"
            disabled={actionsDisabled}
            onClick={() => void onRetry()}
            size="icon"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </ActionTooltip>
      ) : null}
      {onEdit ? (
        <ActionTooltip label={t("chat.editMessage")}>
          <Button
            aria-label={t("chat.editMessage")}
            className="size-7 p-0 text-muted-foreground hover:text-foreground"
            disabled={actionsDisabled}
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
            size="icon"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
          </Button>
        </ActionTooltip>
      ) : null}
      <ActionTooltip label={copied ? t("chat.copied") : t("chat.copyOutput")}>
        <Button
          aria-label={copied ? t("chat.copied") : t("chat.copyOutput")}
          className="size-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={copyOutput}
          size="icon"
          variant="ghost"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </ActionTooltip>
      {message.role !== "user" ? timestamp : null}
      {onEdit ? (
        <Dialog open={editing} onOpenChange={(open) => !submitting && setEditing(open)}>
          <DialogContent className="sm:max-w-xl">
            <form
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEdit();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("chat.editMessage")}</DialogTitle>
              </DialogHeader>
              <label className="sr-only" htmlFor={`edit-message-${messageScrollKey(message)}`}>
                {t("chat.messageContent")}
              </label>
              <textarea
                autoFocus
                className="min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={`edit-message-${messageScrollKey(message)}`}
                onChange={(event) => setDraft(event.target.value)}
                value={draft}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  disabled={
                    actionsDisabled ||
                    !draft.trim() ||
                    draft.trim() === message.content.trim() ||
                    submitting
                  }
                  type="submit"
                >
                  {t("chat.saveAndRetry")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
});

function messageScrollKey(message: ChatMessage) {
  return (message.publicId ?? message.id).replace(/[^a-zA-Z0-9_-]/g, "-");
}
