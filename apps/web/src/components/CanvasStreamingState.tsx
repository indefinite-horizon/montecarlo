/** Loading treatment for a canvas branch waiting on its first response token. */

import { memo } from "react";
import { useTranslation } from "react-i18next";

export const CanvasStreamingState = memo(function CanvasStreamingState() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("canvas.generating")} className="space-y-2.5 py-1">
      {["92%", "78%", "86%", "58%"].map((width) => (
        <span
          key={width}
          className="canvas-skeleton-line block h-2.5 rounded-full"
          style={{ width }}
        />
      ))}
    </div>
  );
});
