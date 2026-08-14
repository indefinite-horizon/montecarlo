/** Links a parent turn to the direct child branches created from it. */

import { GitBranch } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBranch } from "@/lib/conversation";
import { ActionTooltip } from "./ActionTooltip";
import { formatFullDate, formatRelativeDate } from "./MessageOutputActions";

export const BranchTurnCallouts = memo(function BranchTurnCallouts({
  branches,
  onSelect,
}: {
  branches: ChatBranch[];
  onSelect: (branchId: string) => void;
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const callouts = branches.map((branch) => {
    const relativeDate = formatRelativeDate(branch.createdAt, locale);
    const label = t("branch.openChild", { title: branch.title, date: relativeDate });
    return (
      <ActionTooltip key={branch.id} label={formatFullDate(branch.createdAt, locale)} side="left">
        <button
          type="button"
          aria-label={label}
          className="group/callout relative w-full rounded-xl border border-border/80 bg-card/92 px-3 py-2.5 text-left shadow-sm backdrop-blur transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/45 hover:bg-card hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="branch-turn-callout"
          onClick={() => onSelect(branch.id)}
        >
          <span className="flex items-start gap-2">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary transition-colors group-hover/callout:bg-primary/15">
              <GitBranch aria-hidden="true" className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-4 text-foreground">
                {branch.title}
              </span>
              <time
                className="mt-0.5 block text-xs leading-4 text-muted-foreground/75"
                dateTime={new Date(branch.createdAt).toISOString()}
              >
                {relativeDate}
              </time>
            </span>
          </span>
        </button>
      </ActionTooltip>
    );
  });

  return (
    <>
      <aside
        aria-label={t("branch.childrenFromTurn")}
        className="branch-turn-callouts branch-turn-callouts--margin"
      >
        {callouts}
      </aside>
      <aside
        aria-label={t("branch.childrenFromTurn")}
        className="branch-turn-callouts branch-turn-callouts--inline"
      >
        {callouts}
      </aside>
    </>
  );
});
