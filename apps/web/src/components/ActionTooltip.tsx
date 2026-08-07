/** Renders action tooltips with optional platform-aware shortcut hints. */

import { memo, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export const ShortcutHint = memo(function ShortcutHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "shrink-0 whitespace-nowrap font-sans text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
});

export const ActionTooltip = memo(function ActionTooltip({
  children,
  label,
  shortcut,
  side = "top",
  align = "center",
}: {
  children: ReactElement;
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const disabled = (children.props as { disabled?: boolean }).disabled === true;
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? (
            // Disabled native buttons cannot emit hover/focus events; the wrapper owns the tooltip.
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focus exposes disabled-action help to keyboard users.
            <span className="inline-flex" tabIndex={0}>
              {children}
            </span>
          ) : (
            children
          )}
        </TooltipTrigger>
        <TooltipContent side={side} align={align}>
          <span className="flex items-center gap-4">
            <span>{label}</span>
            {shortcut ? (
              <ShortcutHint className="text-background/65">{shortcut}</ShortcutHint>
            ) : null}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
