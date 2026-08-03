/** AnalyticsProvider React context: lazy-loads posthog-js and queues calls until ready. */

import { createContext, type ReactNode, useContext, useMemo, useRef } from "react";
import type { AnalyticsProperties } from "../../../../../lib/analytics/sanitize";
import { buildAppErrorShownEvent } from "./events";
import { createNoopAnalyticsAdapter } from "./noopAdapter";
import type { AnalyticsProvider as AnalyticsAdapter } from "./provider";

type QueuedCall =
  | { kind: "identify"; distinctId: string; props?: AnalyticsProperties }
  | { kind: "reset" }
  | {
      kind: "capture";
      eventName: Parameters<AnalyticsAdapter["capture"]>[0];
      props: AnalyticsProperties;
    };

const QUEUE_LIMIT = 32;

function readEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value === undefined || value === "" ? undefined : value;
}

function isAnalyticsDisabled(): boolean {
  return readEnv("VITE_ANALYTICS_DISABLED")?.toLowerCase() === "true";
}

function createQueueingAdapter(): {
  adapter: AnalyticsAdapter;
  resolveWith: (real: AnalyticsAdapter) => void;
} {
  const queue: QueuedCall[] = [];
  let real: AnalyticsAdapter | null = null;

  const enqueue = (call: QueuedCall) => {
    if (real) {
      replayCall(real, call);
      return;
    }
    if (queue.length >= QUEUE_LIMIT) queue.shift();
    queue.push(call);
  };

  const adapter: AnalyticsAdapter = {
    identify(distinctId, props) {
      enqueue({ kind: "identify", distinctId, props });
    },
    group() {},
    reset() {
      enqueue({ kind: "reset" });
    },
    capture(eventName, props) {
      enqueue({ kind: "capture", eventName, props });
    },
  };

  const resolveWith = (next: AnalyticsAdapter) => {
    real = next;
    while (queue.length > 0) {
      const call = queue.shift();
      if (call) replayCall(next, call);
    }
  };

  return { adapter, resolveWith };
}

function replayCall(adapter: AnalyticsAdapter, call: QueuedCall) {
  switch (call.kind) {
    case "identify":
      adapter.identify(call.distinctId, call.props);
      return;
    case "reset":
      adapter.reset();
      return;
    case "capture":
      adapter.capture(call.eventName, call.props);
      return;
  }
}

type AnalyticsContextValue = {
  adapter: AnalyticsAdapter;
  captureAppError: (input: Parameters<typeof buildAppErrorShownEvent>[0]) => void;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

function selectInitialAdapter(): {
  adapter: AnalyticsAdapter;
  resolveWith?: (real: AnalyticsAdapter) => void;
  loadReal?: () => Promise<AnalyticsAdapter>;
} {
  if (isAnalyticsDisabled()) return { adapter: createNoopAnalyticsAdapter() };
  const token = readEnv("VITE_POSTHOG_PROJECT_TOKEN");
  if (!token) return { adapter: createNoopAnalyticsAdapter() };
  const host = readEnv("VITE_POSTHOG_HOST") ?? "https://us.i.posthog.com";
  const queue = createQueueingAdapter();
  const loadReal = async (): Promise<AnalyticsAdapter> => {
    const { createPostHogAnalyticsAdapter } = await import("./posthogAdapter");
    return createPostHogAnalyticsAdapter({ projectToken: token, host });
  };
  return { adapter: queue.adapter, resolveWith: queue.resolveWith, loadReal };
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const initRef = useRef<ReturnType<typeof selectInitialAdapter> | null>(null);
  if (initRef.current === null) {
    initRef.current = selectInitialAdapter();
    const init = initRef.current;
    if (init.loadReal && init.resolveWith) {
      const resolveWith = init.resolveWith;
      init
        .loadReal()
        .then(resolveWith)
        .catch(() => {
          resolveWith(createNoopAnalyticsAdapter());
        });
    }
  }
  const adapter = initRef.current.adapter;

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      adapter,
      captureAppError: (input) => {
        const event = buildAppErrorShownEvent(input);
        adapter.capture(event.eventName, event.properties);
      },
    }),
    [adapter],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error("useAnalytics must be used within AnalyticsProvider");
  return value;
}

export function useAnalyticsAdapter(): AnalyticsAdapter {
  return useAnalytics().adapter;
}
