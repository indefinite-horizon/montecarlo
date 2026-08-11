/** Provides the shared shadcn message-scroller primitives. */

import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  onPointerDown,
  onPointerDownCapture,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  const { scrollToMessage } = useMessageScroller();
  const releaseFollow = (
    viewport: HTMLElement,
    target: EventTarget | null,
    fallbackToVisibleItem = false,
  ) => {
    let item = target instanceof Element ? target.closest<HTMLElement>("[data-message-id]") : null;
    if (item && !viewport.contains(item)) item = null;
    if (!item && fallbackToVisibleItem) {
      const viewportRect = viewport.getBoundingClientRect();
      item =
        Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
          (candidate) => {
            const rect = candidate.getBoundingClientRect();
            return (
              rect.height > 0 && rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
            );
          },
        ) ?? null;
    }
    const messageId = item?.dataset.messageId;
    const content = item?.parentElement;
    if (!item || !messageId || !content) return;

    // A message jump releases follow. Match its target to the current
    // viewport position so reader intent never moves the transcript.
    const contentStyle = window.getComputedStyle(content);
    const paddingStart = Number.parseFloat(
      contentStyle.paddingBlockStart || contentStyle.paddingTop,
    );
    const scrollMargin =
      item.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      (Number.isFinite(paddingStart) ? paddingStart : 0);
    scrollToMessage(messageId, {
      align: "start",
      behavior: "auto",
      scrollMargin,
    });
  };
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain [contain:content] [scrollbar-gutter:stable] data-autoscrolling:[scrollbar-width:none]",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerDownCapture={(event) => {
        if (event.target !== event.currentTarget) {
          releaseFollow(event.currentTarget, event.target, true);
        }
        onPointerDownCapture?.(event);
      }}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-8", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  behavior = "auto",
  direction = "end",
  className,
  children,
  label,
  render,
  variant = "secondary",
  size = "icon",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    label: React.ReactNode;
  }) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      behavior={behavior}
      direction={direction}
      className={cn(
        "absolute left-1/2 -translate-x-1/2 border-border bg-background text-foreground shadow-md transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-300 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full data-[direction=start]:[&_svg]:rotate-180",
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      aria-label={typeof label === "string" ? label : undefined}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">{label}</span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
