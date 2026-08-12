/** Displays the chat's branch DAG and switches the active line of inquiry. */

import { GitBranch, LoaderCircle, PanelRight, Plus } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChatBranch } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

const DEFAULT_BRANCH_MAP_WIDTH = 304;
const MIN_BRANCH_MAP_WIDTH = 256;
const MAX_BRANCH_MAP_WIDTH = 480;
const BRANCH_MAP_WIDTH_STORAGE_KEY = "monte-carlo:branch-map-width";

function clampBranchMapWidth(width: number): number {
  return Math.min(MAX_BRANCH_MAP_WIDTH, Math.max(MIN_BRANCH_MAP_WIDTH, width));
}

function storedBranchMapWidth(): number {
  const storedWidth = Number.parseFloat(localStorage.getItem(BRANCH_MAP_WIDTH_STORAGE_KEY) ?? "");
  return Number.isFinite(storedWidth) ? clampBranchMapWidth(storedWidth) : DEFAULT_BRANCH_MAP_WIDTH;
}

export const BranchMap = memo(function BranchMap({
  branches,
  activeBranchId,
  unreadBranchId,
  onSelect,
  onCreate,
  open,
  onClose,
  toggleShortcut,
}: {
  branches: ChatBranch[];
  activeBranchId: string;
  unreadBranchId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
  toggleShortcut: string;
}) {
  const { t } = useTranslation();
  const [branchMapWidth, setBranchMapWidth] = useState(storedBranchMapWidth);
  const dragStartRef = useRef<{ clientX: number; width: number } | undefined>(undefined);

  const updateBranchMapWidth = useCallback((width: number) => {
    const nextWidth = clampBranchMapWidth(width);
    setBranchMapWidth(nextWidth);
    localStorage.setItem(BRANCH_MAP_WIDTH_STORAGE_KEY, String(nextWidth));
  }, []);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      if (event.button !== 0) return;
      dragStartRef.current = { clientX: event.clientX, width: branchMapWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [branchMapWidth],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      updateBranchMapWidth(dragStart.width - (event.clientX - dragStart.clientX));
    },
    [updateBranchMapWidth],
  );

  const finishResize = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
    dragStartRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  if (!open) return null;
  return (
    <aside
      aria-label={t("branch.mapTitle")}
      className="branch-map-grid fixed inset-y-0 right-0 z-50 flex h-screen w-[min(304px,88vw)] shrink-0 flex-col border-l border-border bg-card shadow-xl xl:relative xl:z-auto xl:w-[var(--branch-map-width)] xl:bg-card/55 xl:shadow-none"
      style={{ "--branch-map-width": `${branchMapWidth}px` } as CSSProperties}
    >
      <header
        className="electron-titlebar flex h-16 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-5"
        data-testid="branch-map-titlebar"
      >
        <GitBranch className="size-4 text-primary" />
        <h2 className="min-w-0 flex-1 text-xs font-semibold">{t("branch.mapTitle")}</h2>
        <ActionTooltip label={t("branch.closeMap")} shortcut={toggleShortcut} side="left">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("branch.closeMap")}
            aria-expanded={true}
            onClick={onClose}
          >
            <PanelRight />
          </Button>
        </ActionTooltip>
        <span aria-hidden="true" className="electron-titlebar-trailing" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="relative space-y-2.5">
          {branches.map((branch) => {
            const waitingForResponse = branch.messages.some(
              (message) => message.isStreaming || message.runStatus === "running",
            );
            const unread = branch.id === unreadBranchId;
            return (
              <div
                key={branch.id}
                className="relative"
                style={{ marginLeft: `${Math.min(branch.depth, 5) * 18}px` }}
              >
                {branch.depth ? (
                  <span
                    className="absolute -left-[18px] top-5 h-px w-[18px] bg-border"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  data-testid="branch-map-row"
                  data-branch-depth={branch.depth}
                  data-unread={unread ? "true" : "false"}
                  className={cn(
                    "relative w-full rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                    branch.id === activeBranchId
                      ? "border-primary ring-1 ring-primary/25"
                      : "border-border",
                  )}
                  onClick={() => onSelect(branch.id)}
                  aria-busy={waitingForResponse}
                  aria-current={branch.id === activeBranchId ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "absolute -left-1.5 top-3.5 size-2.5 rounded-full border-2 border-card",
                      branch.id === activeBranchId ? "bg-primary" : "bg-border",
                    )}
                  />
                  <span
                    className={cn(
                      "block truncate pr-5 text-[11px]",
                      unread
                        ? "font-semibold text-foreground"
                        : "font-normal text-muted-foreground",
                    )}
                    data-testid="branch-map-title"
                  >
                    {branch.title}
                  </span>
                  {waitingForResponse ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-primary"
                      data-testid="branch-response-spinner"
                    />
                  ) : unread ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-3 top-1/2 size-2 -translate-y-1/2 rounded-full bg-primary"
                      data-testid="branch-unread-indicator"
                    />
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>

        <Button
          className="mt-4 w-full border-dashed"
          size="sm"
          variant="outline"
          disabled={branches.length === 0}
          onClick={onCreate}
        >
          <Plus />
          {t("branch.new")}
        </Button>
      </div>

      <hr
        aria-label={t("branch.resizeMap")}
        aria-orientation="vertical"
        aria-valuemin={MIN_BRANCH_MAP_WIDTH}
        aria-valuemax={MAX_BRANCH_MAP_WIDTH}
        aria-valuenow={branchMapWidth}
        tabIndex={0}
        data-testid="branch-map-resize-handle"
        className="absolute inset-y-0 -left-1 hidden h-auto w-2 cursor-col-resize touch-none border-0 outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary xl:block"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onDoubleClick={() => updateBranchMapWidth(DEFAULT_BRANCH_MAP_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") updateBranchMapWidth(branchMapWidth + 8);
          else if (event.key === "ArrowRight") updateBranchMapWidth(branchMapWidth - 8);
          else if (event.key === "Home") updateBranchMapWidth(MIN_BRANCH_MAP_WIDTH);
          else if (event.key === "End") updateBranchMapWidth(MAX_BRANCH_MAP_WIDTH);
          else return;
          event.preventDefault();
        }}
      />
    </aside>
  );
});
