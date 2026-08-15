/** Runs independent branch-local model turns with durable lease heartbeats. */

import { ConvexError } from "convex/values";
import { type MutableRefObject, useCallback } from "react";
import { toast } from "sonner";
import { startAutomaticChatTitle } from "@/lib/autoChatTitle";
import { type ChatBranch, type ChatMessage, isBranchRunning } from "@/lib/conversation";
import type { MessageItem } from "@/lib/convexDomainApi";
import { streamRuntimeChat } from "@/lib/runtimeClient";
import { buildRuntimeContext } from "@/lib/runtimeContext";
import { sharedConfig } from "../../../../lib/config";
import type { useBranchActivity } from "./useBranchActivity";
import { demoMode, type ReplayContext, type SessionBranch } from "./useConversationSessionState";
import type { useConvexConversationData } from "./useConvexConversationData";

type SessionMessageSetter = React.Dispatch<React.SetStateAction<Record<string, ChatMessage[]>>>;

function isAuthoritativeLeaseLoss(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === "run_no_longer_active"
  );
}

export function useConversationTurnRunner(input: {
  activeBranchId: string;
  activeChatId: string;
  activeSessionBranches: SessionBranch[];
  appendMessages: (branchId: string, additions: ChatMessage[]) => void;
  branchActivity: ReturnType<typeof useBranchActivity>;
  branchActivityNow: number;
  branches: ChatBranch[];
  domain: ReturnType<typeof useConvexConversationData>;
  durable: boolean;
  fastMode: boolean;
  loading: boolean;
  messagePersistenceRef: MutableRefObject<Map<string, Promise<MessageItem | null>>>;
  messages: ChatMessage[];
  persistedMessageIdsRef: MutableRefObject<Map<string, string>>;
  persistenceErrorMessage: string;
  provider: Parameters<typeof streamRuntimeChat>[0]["provider"];
  providerModel: string;
  reasoningEffort: Parameters<typeof streamRuntimeChat>[0]["reasoningEffort"];
  removeMessages: (branchId: string, messageIds: Array<string | undefined>) => void;
  runtimeOfflineMessage: string;
  setChatRunning: (chatId: string, requestId: string, running: boolean) => void;
  setSessionMessages: SessionMessageSetter;
  updateMessage: (
    branchId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage,
  ) => void;
}) {
  return useCallback(
    async (prompt: string, replay?: ReplayContext) => {
      if (input.loading || (!input.durable && !demoMode)) return false;
      const text = prompt.trim();
      if (!text) return false;
      const branchId = replay?.branchId ?? input.activeBranchId;
      const targetBranch = input.branches.find((branch) => branch.id === branchId);
      if (
        input.branchActivity.isLocallyRunning(branchId) ||
        isBranchRunning(targetBranch, input.branchActivityNow)
      ) {
        return false;
      }
      const chatId = input.activeChatId;
      const runFastMode = input.provider === "codex" && input.fastMode;
      const runtimeMessages = buildRuntimeContext(
        replay?.contextMessages ?? input.messages,
        replay?.anchor ?? targetBranch?.anchor,
      );
      const userId = crypto.randomUUID();
      const userMessage: ChatMessage = {
        id: userId,
        publicId: `message_${userId}`,
        branchId,
        role: "user",
        content: text,
        contentReady: true,
        createdAt: Date.now(),
      };
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        publicId: `message_${assistantId}`,
        branchId,
        role: "assistant",
        content: "",
        contentReady: true,
        createdAt: Date.now() + 1,
        provider: input.provider,
        model: input.providerModel,
        runStatus: "running",
        isStreaming: true,
      };
      const controller = input.branchActivity.claim(branchId);
      if (!controller) return false;
      const releaseController = () => input.branchActivity.release(branchId, controller);
      input.setChatRunning(chatId, assistantId, true);
      input.appendMessages(branchId, [userMessage, assistantMessage]);

      const persistedSessionBranch = input.activeSessionBranches.some(
        (entry) => entry.branch.id === branchId && entry.persisted,
      );
      let run = null;
      let leaseExpiresAt = 0;
      let leaseCapability = "";
      if (
        input.durable &&
        (input.domain.durableBranchIds.has(branchId) || persistedSessionBranch)
      ) {
        try {
          const turnPersistence = input.domain.startTurn({
            branchId,
            messageClientId: userMessage.id,
            runClientId: crypto.randomUUID(),
            content: userMessage.content,
            provider: input.provider,
            model: input.providerModel,
            reasoningEffort: input.reasoningEffort,
            fastMode: runFastMode,
          });
          input.messagePersistenceRef.current.set(
            userMessage.id,
            turnPersistence.then((result) => result?.message ?? null),
          );
          const turn = await turnPersistence;
          input.messagePersistenceRef.current.delete(userMessage.id);
          const inputMessage = turn?.message;
          run = turn?.run ?? null;
          if (turn) {
            leaseExpiresAt = turn.leaseExpiresAt;
            leaseCapability = turn.leaseCapability;
          }
          if (inputMessage) {
            input.persistedMessageIdsRef.current.set(userMessage.id, String(inputMessage.id));
            input.updateMessage(branchId, userMessage.id, (message) => ({
              ...message,
              id: String(inputMessage.id),
              persisted: true,
            }));
            const titleClaimToken = crypto.randomUUID();
            void startAutomaticChatTitle({
              claim: () =>
                input.domain.claimAutoTitle(
                  chatId,
                  titleClaimToken,
                  input.provider,
                  input.providerModel,
                ),
              complete: (title) => input.domain.completeAutoTitle(chatId, titleClaimToken, title),
              release: () => input.domain.releaseAutoTitle(chatId, titleClaimToken),
            });
          }
        } catch {
          input.setChatRunning(chatId, assistantId, false);
          releaseController();
          input.messagePersistenceRef.current.delete(userMessage.id);
          toast.error(input.persistenceErrorMessage);
          input.setSessionMessages((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).filter(
              (message) => message.id !== userMessage.id && message.id !== assistantId,
            ),
          }));
          return false;
        }
        if (!run) {
          input.setChatRunning(chatId, assistantId, false);
          releaseController();
          toast.error(input.persistenceErrorMessage);
          input.setSessionMessages((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).filter(
              (message) => message.id !== userMessage.id && message.id !== assistantId,
            ),
          }));
          return false;
        }
      }

      let outcome: "succeeded" | "failed" | "canceled" = "succeeded";
      let assistantContent = "";
      let persistedAssistantId: string | undefined;
      let receivedFinish = false;
      let heartbeatTimer: number | undefined;
      let heartbeatInFlight = false;
      let heartbeatPromise: Promise<unknown> | undefined;
      let leaseLost = false;
      let terminalizing = false;
      let finalOutcome: "succeeded" | "failed" | "canceled" = "failed";
      let finalDurableRunCompleted = false;
      const stopLeaseHeartbeat = () => {
        terminalizing = true;
        if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      };
      if (run) {
        const heartbeat = () => {
          if (heartbeatInFlight || terminalizing) return;
          heartbeatInFlight = true;
          heartbeatPromise = input.domain
            .renewRunLease(run, leaseCapability)
            .then((renewed) => {
              if (renewed) leaseExpiresAt = renewed.leaseExpiresAt;
            })
            .catch((error: unknown) => {
              if (isAuthoritativeLeaseLoss(error) || Date.now() >= leaseExpiresAt) {
                leaseLost = true;
                controller.abort();
              }
            })
            .finally(() => {
              heartbeatInFlight = false;
              heartbeatPromise = undefined;
            });
        };
        heartbeatTimer = window.setInterval(heartbeat, sharedConfig.runs.heartbeatIntervalMs);
        heartbeat();
      }
      try {
        if (controller.signal.aborted) {
          outcome = leaseLost ? "failed" : "canceled";
        } else {
          await streamRuntimeChat({
            provider: input.provider,
            model: input.providerModel,
            messages: runtimeMessages,
            prompt: text,
            reasoningEffort: input.reasoningEffort,
            fastMode: runFastMode,
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "finish") {
                receivedFinish = true;
                if (event.finishReason === "cancelled" || event.finishReason === "canceled") {
                  outcome = "canceled";
                } else if (event.finishReason === "error") {
                  outcome = "failed";
                }
                return;
              }
              if (event.type !== "text-delta") return;
              assistantContent += event.delta;
              input.updateMessage(branchId, assistantId, (message) => ({
                ...message,
                content: `${message.content}${event.delta}`,
              }));
            },
          });
          if (!receivedFinish) throw new Error("Runtime stream ended without a finish event.");
        }
      } catch {
        if (controller.signal.aborted) {
          outcome = leaseLost ? "failed" : "canceled";
          if (leaseLost) toast.error(input.persistenceErrorMessage);
        } else {
          outcome = "failed";
          assistantContent = "";
          const leaseStillCurrent =
            !run ||
            (await input.domain.renewRunLease(run, leaseCapability).catch(() => null)) !== null;
          toast.error(
            leaseStillCurrent ? input.runtimeOfflineMessage : input.persistenceErrorMessage,
          );
          input.removeMessages(branchId, [assistantId]);
        }
      } finally {
        let terminalOutcome = outcome;
        let durableRunCompleted = !run;
        if (controller.signal.aborted && !leaseLost) terminalOutcome = "canceled";
        if (run && !leaseLost) {
          let outputMessageId: MessageItem["id"] | undefined;
          if (assistantContent.trim()) {
            try {
              const outputPersistence = input.domain.persistMessage({
                branchId,
                clientId: assistantId,
                role: "assistant",
                content: assistantContent,
                runId: run.id,
                leaseCapability,
              });
              input.messagePersistenceRef.current.set(assistantId, outputPersistence);
              const outputMessage = await outputPersistence;
              input.messagePersistenceRef.current.delete(assistantId);
              if (outputMessage) {
                outputMessageId = outputMessage.id;
                persistedAssistantId = String(outputMessage.id);
                input.persistedMessageIdsRef.current.set(assistantId, persistedAssistantId);
                input.updateMessage(branchId, assistantId, (message) => ({
                  ...message,
                  id: persistedAssistantId as string,
                }));
              } else {
                terminalOutcome = "failed";
                toast.error(input.persistenceErrorMessage);
                input.removeMessages(branchId, [assistantId]);
              }
            } catch {
              input.messagePersistenceRef.current.delete(assistantId);
              terminalOutcome = "failed";
              toast.error(input.persistenceErrorMessage);
              input.removeMessages(branchId, [assistantId]);
            }
          }
          if (controller.signal.aborted && !leaseLost) terminalOutcome = "canceled";
          stopLeaseHeartbeat();
          if (heartbeatPromise) await heartbeatPromise;
          // The runtime and output upload are settled; do not offer a Stop action once
          // the authoritative completion mutation is already being dispatched.
          releaseController();
          if (!leaseLost) {
            try {
              await input.domain.completeRun(
                run,
                leaseCapability,
                terminalOutcome,
                outputMessageId,
              );
              durableRunCompleted = true;
            } catch {
              try {
                await input.domain.completeRun(
                  run,
                  leaseCapability,
                  terminalOutcome,
                  outputMessageId,
                );
                durableRunCompleted = true;
              } catch {
                try {
                  await input.domain.completeRun(run, leaseCapability, "failed");
                  terminalOutcome = "failed";
                  durableRunCompleted = true;
                } catch {
                  // The local request is over. Durable branch metadata keeps the branch
                  // busy until the lease expires or another mutation settles it.
                }
                toast.error(input.persistenceErrorMessage);
              }
            }
          }
        }
        stopLeaseHeartbeat();
        if (heartbeatPromise) await heartbeatPromise;
        if (leaseLost) {
          input.removeMessages(branchId, [assistantId, persistedAssistantId]);
          input.setChatRunning(chatId, assistantId, false);
        } else if (!assistantContent.trim()) {
          input.removeMessages(branchId, [assistantId, persistedAssistantId]);
        } else if (durableRunCompleted) {
          input.updateMessage(branchId, persistedAssistantId ?? assistantId, (message) => ({
            ...message,
            isStreaming: false,
            runStatus: terminalOutcome,
          }));
        }
        // Local streaming state must never outlive the runtime request. When durable
        // completion fails, the branch's lease remains the authoritative busy signal.
        if (!durableRunCompleted && !leaseLost && assistantContent.trim()) {
          input.updateMessage(branchId, persistedAssistantId ?? assistantId, (message) => ({
            ...message,
            isStreaming: false,
            runStatus: "failed",
          }));
        }
        input.setChatRunning(chatId, assistantId, false);
        finalOutcome = terminalOutcome;
        finalDurableRunCompleted = durableRunCompleted;
        releaseController();
      }
      return finalDurableRunCompleted && finalOutcome === "succeeded";
    },
    [input],
  );
}
