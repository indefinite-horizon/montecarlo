/** Hydrates bounded persisted message previews without blocking transcript rendering. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageItem } from "@/lib/convexDomainApi";
import { getRuntimeMessageContent } from "@/lib/runtimeClient";

const MAX_HYDRATED_MESSAGES = 256;
const MESSAGE_CONTENT_READ_TIMEOUT_MS = 2_000;

export function messageHydrationKey(message: MessageItem): string {
  return `${message.objectKey}:${message.sha256}`;
}

async function hydrateMessageContent(message: MessageItem, signal: AbortSignal): Promise<string> {
  const readController = new AbortController();
  const abortRead = () => readController.abort();
  signal.addEventListener("abort", abortRead, { once: true });
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      readController.abort();
      reject(new DOMException("Message content hydration timed out.", "TimeoutError"));
    }, MESSAGE_CONTENT_READ_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      getRuntimeMessageContent({
        objectKey: message.objectKey,
        backend: message.backend,
        envelopeVersion: message.envelopeVersion,
        byteLength: message.byteLength,
        sha256: message.sha256,
        signal: readController.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortRead);
  }
}

export function useMessageContentHydration(messageSummaries: MessageItem[]) {
  const [hydratedContent, setHydratedContent] = useState<Record<string, string>>({});
  const [settledHydrationKeys, setSettledHydrationKeys] = useState<Record<string, true>>({});
  const settledHydrationKeysRef = useRef<Record<string, true>>({});
  const hydrationTargets = useMemo(() => {
    const seen = new Set<string>();
    return [...messageSummaries]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_HYDRATED_MESSAGES)
      .filter((message) => {
        const key = messageHydrationKey(message);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [messageSummaries]);
  const hydrationTargetKeys = useMemo(
    () => new Set(hydrationTargets.map(messageHydrationKey)),
    [hydrationTargets],
  );

  // lint-allow: no-direct-use-effect — hydrate persisted blobs and abort obsolete reads.
  useEffect(() => {
    const controller = new AbortController();
    const targets = hydrationTargets.filter(
      (message) => settledHydrationKeysRef.current[messageHydrationKey(message)] === undefined,
    );
    let cursor = 0;

    const hydrateNext = async () => {
      while (!controller.signal.aborted) {
        const message = targets[cursor];
        cursor += 1;
        if (!message) return;
        const key = messageHydrationKey(message);
        try {
          const content = await hydrateMessageContent(message, controller.signal);
          if (!controller.signal.aborted) {
            setHydratedContent((current) => {
              const next = { ...current, [key]: content };
              const excess = Object.keys(next).length - MAX_HYDRATED_MESSAGES;
              if (excess > 0) {
                for (const hydratedKey of Object.keys(next).slice(0, excess)) {
                  delete next[hydratedKey];
                }
              }
              return next;
            });
          }
        } catch {
          // The Convex preview remains visible when the local runtime or blob is unavailable.
        } finally {
          if (!controller.signal.aborted) {
            setSettledHydrationKeys((current) => {
              if (current[key]) return current;
              const next = { ...current, [key]: true as const };
              const excess = Object.keys(next).length - MAX_HYDRATED_MESSAGES;
              if (excess > 0) {
                for (const settledKey of Object.keys(next).slice(0, excess)) {
                  delete next[settledKey];
                }
              }
              settledHydrationKeysRef.current = next;
              return next;
            });
          }
        }
      }
    };

    const workerCount = Math.min(4, targets.length);
    void Promise.all(Array.from({ length: workerCount }, () => hydrateNext()));
    return () => controller.abort();
  }, [hydrationTargets]);

  const isMessageContentReady = useCallback(
    (message: MessageItem) =>
      !hydrationTargetKeys.has(messageHydrationKey(message)) ||
      settledHydrationKeys[messageHydrationKey(message)] === true,
    [hydrationTargetKeys, settledHydrationKeys],
  );

  return { hydratedContent, isMessageContentReady };
}
