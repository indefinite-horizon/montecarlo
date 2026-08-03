/** Displays the chat's branch DAG and switches the active line of inquiry. */

import { GitBranch, PanelRightClose, Plus } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBranch } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const BranchMap = memo(function BranchMap({
  branches,
  activeBranchId,
  onSelect,
  onCreate,
}: {
  branches: ChatBranch[];
  activeBranchId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="branch-map-grid hidden h-screen w-[304px] shrink-0 flex-col border-l border-border bg-card/55 xl:flex">
      <header className="flex h-16 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <GitBranch className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold">{t("branch.mapTitle")}</h2>
          <p className="text-[10px] text-muted-foreground">
            {t("branch.count", { count: branches.length })}
          </p>
        </div>
        <Button size="icon" variant="ghost" aria-label={t("branch.closeMap")}>
          <PanelRightClose />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="relative space-y-2.5">
          {branches.map((branch) => (
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
                className={cn(
                  "relative w-full rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                  branch.id === activeBranchId
                    ? "border-primary ring-1 ring-primary/25"
                    : "border-border",
                )}
                onClick={() => onSelect(branch.id)}
              >
                <span
                  className={cn(
                    "absolute -left-1.5 top-3.5 size-2.5 rounded-full border-2 border-card",
                    branch.id === activeBranchId ? "bg-primary" : "bg-border",
                  )}
                />
                <span className="block truncate text-[11px] font-semibold">{branch.title}</span>
                {branch.anchor?.selectedText ? (
                  <span className="mt-1 line-clamp-2 block font-display text-[10px] italic leading-4 text-muted-foreground">
                    “{branch.anchor.selectedText}”
                  </span>
                ) : (
                  <span className="mt-1 block text-[9px] text-muted-foreground">
                    {t("branch.rootLabel")}
                  </span>
                )}
                <span className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground">
                  <span className="size-1 rounded-full bg-primary" />
                  {t("branch.turnCount", { count: branch.messages.length })}
                </span>
              </button>
            </div>
          ))}
        </div>

        <Button
          className="mt-4 w-full border-dashed"
          size="sm"
          variant="outline"
          onClick={onCreate}
        >
          <Plus />
          {t("branch.new")}
        </Button>
      </div>

      <footer className="border-t border-border bg-background/75 px-4 py-3 text-[10px] leading-4 text-muted-foreground">
        {t("branch.tip")}
      </footer>
    </aside>
  );
});
