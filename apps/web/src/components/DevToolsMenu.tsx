/** Dev-only branch chip and database command menu. */

import { useAction } from "convex/react";
import { DatabaseZap, RotateCcw, Trash2, Wrench } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEventListener } from "@/hooks/useEventListener";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { Button } from "./ui/button";

type PendingCommand = "wipe" | "reseed" | "wipeAndReseed" | null;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readDevGitRefLabel(): string {
  if (!import.meta.env.DEV) return "";
  return import.meta.env.VITE_DEV_GIT_BRANCH?.trim() ?? "";
}

export const DevToolsMenu = memo(function DevToolsMenu() {
  const { t } = useTranslation();
  const branchLabel = readDevGitRefLabel();
  const [open, setOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wipeAll = useAction(api.functions.devTools.wipeAll);
  const reseed = useAction(api.functions.devTools.reseed);
  const wipeAndReseed = useAction(api.functions.devTools.wipeAndReseed);

  useEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") setOpen(false);
    },
    { enabled: open },
  );

  useEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuRef.current?.contains(target)) setOpen(false);
    },
    { enabled: open, target: "document" },
  );

  const handleWipe = useCallback(async () => {
    if (!window.confirm(t("devTools.wipeConfirm"))) return;

    setPendingCommand("wipe");
    try {
      const result = await wipeAll();
      toast.success(t("devTools.wipeSuccess", { count: result.totalDeleted }));
    } catch (error) {
      toast.error(getErrorMessage(error, t("devTools.wipeError")));
    } finally {
      setPendingCommand(null);
    }
  }, [t, wipeAll]);

  const handleReseed = useCallback(async () => {
    setPendingCommand("reseed");
    try {
      await reseed();
      toast.success(t("devTools.reseedSuccess"));
    } catch (error) {
      toast.error(getErrorMessage(error, t("devTools.reseedError")));
    } finally {
      setPendingCommand(null);
    }
  }, [reseed, t]);

  const handleWipeAndReseed = useCallback(async () => {
    if (!window.confirm(t("devTools.wipeAndReseedConfirm"))) return;

    setPendingCommand("wipeAndReseed");
    try {
      const result = await wipeAndReseed();
      toast.success(t("devTools.wipeAndReseedSuccess", { count: result.totalDeleted }));
    } catch (error) {
      toast.error(getErrorMessage(error, t("devTools.wipeAndReseedError")));
    } finally {
      setPendingCommand(null);
    }
  }, [t, wipeAndReseed]);

  if (!branchLabel) return null;

  const busy = pendingCommand !== null;

  return (
    <div ref={menuRef} className="fixed top-2 right-2 z-50 flex flex-col items-end gap-2">
      <div className="flex items-center gap-1 rounded-md bg-foreground px-2 py-1 font-mono text-[10px] text-background shadow-sm">
        <span className="max-w-56 truncate" title={branchLabel}>
          {branchLabel}
        </span>
        <button
          type="button"
          className={cn(
            "ml-1 rounded p-0.5 transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-background",
            open && "bg-background/20",
          )}
          aria-label={t("devTools.open")}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Wrench className="size-3" />
        </button>
      </div>

      {open ? (
        <div className="w-[min(calc(100vw-1rem),24rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="mb-3">
            <p className="text-sm font-semibold">{t("devTools.title")}</p>
            <p className="text-xs text-muted-foreground">{t("devTools.description")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <DevToolsCommand
              icon={<DatabaseZap className="size-4" />}
              title={t("devTools.wipeAndReseedTitle")}
              description={t("devTools.wipeAndReseedDescription")}
              actionLabel={
                pendingCommand === "wipeAndReseed"
                  ? t("devTools.wipeAndReseeding")
                  : t("devTools.wipeAndReseed")
              }
              destructive
              disabled={busy}
              onClick={() => void handleWipeAndReseed()}
            />
            <DevToolsCommand
              icon={<Trash2 className="size-4" />}
              title={t("devTools.wipeTitle")}
              description={t("devTools.wipeDescription")}
              actionLabel={pendingCommand === "wipe" ? t("devTools.wiping") : t("devTools.wipe")}
              destructive
              disabled={busy}
              onClick={() => void handleWipe()}
            />
            <DevToolsCommand
              icon={<RotateCcw className="size-4" />}
              title={t("devTools.reseedTitle")}
              description={t("devTools.reseedDescription")}
              actionLabel={
                pendingCommand === "reseed" ? t("devTools.reseeding") : t("devTools.reseed")
              }
              disabled={busy}
              onClick={() => void handleReseed()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});

interface DevToolsCommandProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}

function DevToolsCommand({
  icon,
  title,
  description,
  actionLabel,
  destructive = false,
  disabled,
  onClick,
}: DevToolsCommandProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5">{title}</p>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={destructive ? "destructive" : "outline"}
        className="shrink-0"
        disabled={disabled}
        onClick={onClick}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
