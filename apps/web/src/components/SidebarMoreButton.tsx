/** Reveals the next page of chats while matching sidebar row geometry. */

import { memo } from "react";
import { useTranslation } from "react-i18next";

export const SidebarMoreButton = memo(function SidebarMoreButton({
  ariaLabel,
  controls,
  onClick,
}: {
  ariaLabel: string;
  controls: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="show-more-chats"
      className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-card/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-label={ariaLabel}
      aria-controls={controls}
      onClick={onClick}
    >
      <span className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("sidebar.more")}</span>
    </button>
  );
});
