/** Cycles the reasoning effort used for the next model run. */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  nextReasoningEffort,
  type ReasoningEffort,
  userReasoningEfforts,
} from "@/lib/conversation";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

function ThinkingLevelIndicator({
  levels,
  value,
}: {
  levels: readonly Exclude<ReasoningEffort, "none">[];
  value: ReasoningEffort;
}) {
  const activeBarCount = value === "none" ? 0 : Math.max(0, levels.indexOf(value) + 1);

  return (
    <span
      aria-hidden="true"
      className="flex h-3.5 shrink-0 items-end gap-0.5"
      data-testid="thinking-level-indicator"
      data-bar-count={levels.length}
      data-active-bars={activeBarCount}
    >
      {levels.map((level, index) => {
        const active = index < activeBarCount;
        const height =
          levels.length === 1 ? 14 : 4 + Math.round((index * 10) / (levels.length - 1));
        return (
          <span
            key={level}
            className={`w-0.5 rounded-full bg-current transition-opacity duration-150 motion-reduce:transition-none ${active ? "opacity-100" : "opacity-30"}`}
            data-testid="thinking-level-bar"
            data-state={active ? "active" : "inactive"}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </span>
  );
}

export const ThinkingLevelSelector = memo(function ThinkingLevelSelector({
  value,
  onChange,
  options = userReasoningEfforts,
  shortcut,
}: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  options?: readonly ReasoningEffort[];
  shortcut?: string;
}) {
  const { t } = useTranslation();
  const levels = options.filter(
    (option): option is Exclude<ReasoningEffort, "none"> => option !== "none",
  );

  return (
    <ActionTooltip label={t("composer.adjustThinking")} shortcut={shortcut}>
      <Button
        data-testid="thinking-level-trigger"
        className="gap-1.5 px-2.5 text-muted-foreground"
        variant="ghost"
        aria-label={`${t("composer.adjustThinking")}: ${t(`composer.thinkingLevels.${value}`)}`}
        onClick={() => onChange(nextReasoningEffort(value, options))}
      >
        <ThinkingLevelIndicator levels={levels} value={value} />
        {value !== "none" ? (
          <span className="hidden text-xs sm:inline">{t(`composer.thinkingLevels.${value}`)}</span>
        ) : null}
      </Button>
    </ActionTooltip>
  );
});
