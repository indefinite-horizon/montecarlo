/** Marks where the focused child branch diverged from its parent transcript. */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "./ActionTooltip";
import { formatFullDate, formatRelativeDate } from "./MessageOutputActions";

export const BranchOriginDivider = memo(function BranchOriginDivider({
  createdAt,
}: {
  createdAt: number;
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const relativeDate = formatRelativeDate(createdAt, locale);
  const fullDate = formatFullDate(createdAt, locale);

  return (
    <div
      className="mx-auto mb-8 flex w-full max-w-3xl items-center gap-3 px-5 text-[11px] text-muted-foreground sm:px-8"
      data-testid="branch-origin-divider"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <ActionTooltip label={fullDate}>
        <time className="shrink-0" dateTime={new Date(createdAt).toISOString()}>
          {t("branch.branchedFromParent", { date: relativeDate })}
        </time>
      </ActionTooltip>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
});
