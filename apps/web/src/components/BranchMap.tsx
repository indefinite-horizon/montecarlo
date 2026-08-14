/** Displays the chat's branch DAG and switches the active line of inquiry. */

import {
  GitBranch,
  Link2,
  LoaderCircle,
  Mail,
  MailOpen,
  PanelRight,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type ChatBranch, isBranchRunning } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

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
  activityNow,
  unreadBranchId,
  onSelect,
  onCreate,
  onCopyLink,
  onDelete,
  onRename,
  onSetUnread,
  open,
  onClose,
  toggleShortcut,
}: {
  branches: ChatBranch[];
  activeBranchId: string;
  activityNow: number;
  unreadBranchId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  onSetUnread: (id: string, unread: boolean) => void;
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
        className="electron-titlebar flex h-12 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-5 [&_button]:size-9 [&_button_svg]:size-4"
        data-testid="branch-map-titlebar"
      >
        <GitBranch className="size-4 text-primary" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{t("branch.mapTitle")}</h2>
        {/* Keep this toggle's position synchronized with the open-branch-map toggle in WorkspaceHeader. */}
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
            const waitingForResponse = isBranchRunning(branch, activityNow);
            const unread = branch.id === unreadBranchId;
            const branchUnread = branch.isUnread || unread;
            return (
              <div
                key={branch.id}
                className="group/branch relative"
                style={{ marginLeft: `${Math.min(branch.depth, 5) * 18}px` }}
              >
                {branch.depth ? (
                  <span
                    className="absolute -left-[18px] top-5 h-px w-[18px] bg-border"
                    aria-hidden="true"
                  />
                ) : null}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="branch-map-row"
                      data-branch-depth={branch.depth}
                      data-unread={branchUnread ? "true" : "false"}
                      className={cn(
                        "relative w-full rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
                          "block truncate pr-5 text-sm",
                          branchUnread
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
                          className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-primary transition-opacity group-hover/branch:opacity-0 group-focus-within/branch:opacity-0"
                          data-testid="branch-response-spinner"
                        />
                      ) : branchUnread ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-3 top-1/2 size-2 -translate-y-1/2 rounded-full bg-primary transition-opacity group-hover/branch:opacity-0 group-focus-within/branch:opacity-0"
                          data-testid="branch-unread-indicator"
                        />
                      ) : null}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    className="w-52"
                    data-testid="branch-context-menu"
                    aria-label={t("branch.actionsNamed", { title: branch.title })}
                  >
                    <ContextMenuItem onSelect={() => onSetUnread(branch.id, !branchUnread)}>
                      {branchUnread ? <MailOpen /> : <Mail />}
                      {t(branchUnread ? "branch.markRead" : "branch.markUnread")}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onRename(branch.id)}>
                      <Pencil />
                      {t("sidebar.rename")}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCopyLink(branch.id)}>
                      <Link2 />
                      {t("sidebar.copyLink")}
                    </ContextMenuItem>
                    {branch.parentBranchId ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onSelect={() => onDelete(branch.id)}>
                          <Trash2 />
                          {t("branch.delete")}
                        </ContextMenuItem>
                      </>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
                <ActionTooltip label={t("branch.new")} side="left">
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-100 outline-none transition-[color,background-color,opacity] hover:bg-background/80 hover:text-muted-foreground focus-visible:bg-background/80 focus-visible:text-muted-foreground md:opacity-0 md:group-hover/branch:opacity-100 md:group-focus-within/branch:opacity-100"
                    aria-label={t("branch.new")}
                    data-testid="branch-map-create"
                    disabled={waitingForResponse}
                    onClick={() => {
                      onSelect(branch.id);
                      onCreate();
                    }}
                  >
                    <GitBranch className="size-3.5" />
                  </button>
                </ActionTooltip>
              </div>
            );
          })}
        </div>
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
