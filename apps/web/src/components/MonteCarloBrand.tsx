/** Renders the original Monte Carlo branch mark and compact wordmark. */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const MonteCarloBrand = memo(function MonteCarloBrand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm"
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" className="size-7" role="presentation">
          <path
            d="M8 7v18M8 11h8v8M16 15h8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
          <circle cx="8" cy="7" r="2.4" className="fill-primary" />
          <circle cx="8" cy="25" r="2.4" className="fill-primary" />
          <circle cx="16" cy="19" r="2.4" className="fill-primary" />
          <circle cx="24" cy="15" r="2.4" className="fill-primary" />
        </svg>
      </span>
      {compact ? null : (
        <span className="font-display text-[19px] font-bold tracking-[-0.025em]">
          {t("app.name")}
        </span>
      )}
    </span>
  );
});
