/** Recovers pending or abandoned chat-title jobs without blocking the visible conversation. */

import { useEffect, useRef } from "react";
import { startAutomaticChatTitle } from "@/lib/autoChatTitle";
import type { ProviderId } from "@/lib/conversation";
import { sharedConfig } from "../../../../lib/config";

type AutoTitleStatus = "pending" | "generating" | "generated" | undefined;

export function useAutomaticChatTitle({
  activeChatId,
  enabled,
  status,
  provider,
  model,
  claim,
  complete,
  release,
}: {
  activeChatId: string;
  enabled: boolean;
  status: AutoTitleStatus;
  provider: ProviderId;
  model: string;
  claim: (
    chatId: string,
    claimToken: string,
    provider: ProviderId,
    model: string,
  ) => Promise<{ intent: string; provider: ProviderId; model: string } | null>;
  complete: (chatId: string, claimToken: string, title: string) => Promise<boolean>;
  release: (chatId: string, claimToken: string) => Promise<boolean>;
}) {
  const currentRef = useRef({ status, provider, model });
  currentRef.current = { status, provider, model };

  // lint-allow: no-direct-use-effect — a bounded poll reclaims persisted title leases after reloads.
  useEffect(() => {
    if (!enabled || !activeChatId) return;
    let recoveryFailures = 0;
    let inFlight = false;
    const controller = new AbortController();
    const attempt = () => {
      const current = currentRef.current;
      if (current.status !== "pending" && current.status !== "generating") return;
      if (inFlight || recoveryFailures >= sharedConfig.chatNaming.maxRecoveryAttempts) return;
      const claimToken = crypto.randomUUID();
      inFlight = true;
      void startAutomaticChatTitle({
        claim: () => claim(activeChatId, claimToken, current.provider, current.model),
        complete: (title) => complete(activeChatId, claimToken, title),
        release: () => release(activeChatId, claimToken),
        signal: controller.signal,
      })
        .then((outcome) => {
          if (outcome === "failed") recoveryFailures += 1;
        })
        .finally(() => {
          inFlight = false;
        });
    };
    attempt();
    const timer = window.setInterval(attempt, sharedConfig.chatNaming.retryPollMs);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [activeChatId, claim, complete, enabled, release]);
}
