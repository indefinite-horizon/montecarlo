/** Dev-only branch chip and database command menu. */

import { useAction } from "convex/react";
import { DatabaseZap, GripVertical, RotateCcw, Trash2, Wrench } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEventListener } from "@/hooks/useEventListener";
import { clampDevToolsPosition } from "@/lib/devToolsMenu";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

type PendingCommand = "wipe" | "reseed" | "wipeAndReseed" | null;
type MenuPosition = { x: number; y: number };

const VIEWPORT_GUTTER = 8;

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
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
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

  useEventListener("resize", () => {
    const menu = menuRef.current;
    if (!menu || !position) return;
    setPosition(
      clampDevToolsPosition(position, menu.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  });

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;

    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect.left + rect.width / 2),
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const menu = menuRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !menu) return;

    setPosition(
      clampDevToolsPosition(
        { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
        menu.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  const handleDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleToggleMenu = useCallback(() => {
    if (!open) {
      requestAnimationFrame(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        setPosition((current) =>
          clampDevToolsPosition(current ?? { x: rect.left + rect.width / 2, y: rect.top }, rect, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      });
    }
    setOpen(!open);
  }, [open]);

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
    <div
      ref={menuRef}
      className="pointer-events-none fixed z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ left: position?.x ?? "50%", top: position?.y ?? VIEWPORT_GUTTER }}
    >
      <div
        className="pointer-events-auto flex touch-none select-none items-center gap-1 rounded-md bg-foreground px-1.5 py-1 font-mono text-[10px] text-background shadow-sm cursor-grab active:cursor-grabbing"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <GripVertical className="size-3 text-background/60" aria-hidden="true" />
        <span className="max-w-56 truncate" title={branchLabel}>
          {branchLabel}
        </span>
        <ActionTooltip label={t("devTools.open")} side="bottom">
          <button
            type="button"
            className={cn(
              "pointer-events-auto ml-1 rounded p-0.5 transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-background",
              open && "bg-background/20",
            )}
            aria-label={t("devTools.open")}
            aria-expanded={open}
            onClick={handleToggleMenu}
          >
            <Wrench className="size-3" />
          </button>
        </ActionTooltip>
      </div>

      {open ? (
        <div className="pointer-events-auto w-[min(calc(100vw-1rem),24rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <p className="mb-3 text-sm font-semibold">{t("devTools.title")}</p>
          <div className="flex flex-col gap-2">
            <DevToolsCommand
              icon={<DatabaseZap className="size-4" />}
              title={t("devTools.wipeAndReseedTitle")}
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
              actionLabel={pendingCommand === "wipe" ? t("devTools.wiping") : t("devTools.wipe")}
              destructive
              disabled={busy}
              onClick={() => void handleWipe()}
            />
            <DevToolsCommand
              icon={<RotateCcw className="size-4" />}
              title={t("devTools.reseedTitle")}
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
  actionLabel: string;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}

function DevToolsCommand({
  icon,
  title,
  actionLabel,
  destructive = false,
  disabled,
  onClick,
}: DevToolsCommandProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <p className="min-w-0 text-sm font-medium leading-5">{title}</p>
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
