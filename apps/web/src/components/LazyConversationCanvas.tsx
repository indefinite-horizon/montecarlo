/** Lazy boundary for the canvas-only React Flow bundle. */

import { lazy, memo } from "react";

export const LazyConversationCanvas = memo(
  lazy(() =>
    import("./ConversationCanvas").then(({ ConversationCanvas }) => ({
      default: ConversationCanvas,
    })),
  ),
);
