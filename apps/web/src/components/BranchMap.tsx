/** Displays the chat's branch DAG and switches the active line of inquiry. */

import { GitBranch, PanelRight, Plus } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBranch } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

export const BranchMap = memo(function BranchMap({
  branches,
  activeBranchId,
  onSelect,
  onCreate,
  open,
  onClose,
}: {
  branches: ChatBranch[];
  activeBranchId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <aside
      aria-label={t("branch.mapTitle")}
      className="branch-map-grid fixed inset-y-0 right-0 z-50 flex h-screen w-[304px] max-w-[88vw] shrink-0 flex-col border-l border-border bg-card shadow-xl xl:relative xl:z-auto xl:bg-card/55 xl:shadow-none"
    >
      <header className="flex h-16 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-5">
        <GitBranch className="size-4 text-primary" />
        <h2 className="min-w-0 flex-1 text-xs font-semibold">{t("branch.mapTitle")}</h2>
        <ActionTooltip label={t("branch.closeMap")} side="left">
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
                data-testid="branch-map-row"
                data-branch-depth={branch.depth}
                className={cn(
                  "relative w-full rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                  branch.id === activeBranchId
                    ? "border-primary ring-1 ring-primary/25"
                    : "border-border",
                )}
                onClick={() => onSelect(branch.id)}
                aria-current={branch.id === activeBranchId ? "true" : undefined}
              >
                <span
                  className={cn(
                    "absolute -left-1.5 top-3.5 size-2.5 rounded-full border-2 border-card",
                    branch.id === activeBranchId ? "bg-primary" : "bg-border",
                  )}
                />
                <span className="block truncate text-[11px] font-semibold">{branch.title}</span>
              </button>
            </div>
          ))}
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
    </aside>
  );
});
