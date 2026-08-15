/** Prepares blob-backed message content and exposes durable turn mutations. */

import { useCallback, useMemo, useRef } from "react";
import type { ProviderId, ReasoningEffort } from "@/lib/conversation";
import type {
  BlobManifestItem,
  MessageItem,
  RunItem,
  StartTurnResult,
  WorkspaceItem,
} from "@/lib/convexDomainApi";
import {
  browserSessionStorage,
  claimOrphanedRunLeases,
  forgetOwnedRunLease,
  rememberOwnedRunLease,
  restoreOrphanedRunLease,
  runLeaseRecoveryDocumentId,
} from "@/lib/runLeaseRecovery";
import {
  encodeMessageEnvelope,
  MESSAGE_ENVELOPE_CONTENT_TYPE,
  putRuntimeBlob,
} from "@/lib/runtimeClient";
import type { Id } from "../../../../convex/_generated/dataModel";
import { sharedConfig } from "../../../../lib/config";

export function useDurableTurnMutations(input: {
  workspace?: WorkspaceItem;
  chatId?: Id<"chats">;
  reserveBlob: (args: {
    workspaceId: Id<"workspaces">;
    backend: "filesystem" | "r2";
    envelopeVersion: number;
    contentType: string;
    byteLength: number;
    sha256: string;
  }) => Promise<BlobManifestItem>;
  markBlobAvailable: (args: {
    workspaceId: Id<"workspaces">;
    manifestId: Id<"blob_manifests">;
    attestation: string;
  }) => Promise<BlobManifestItem>;
  appendMessage: (args: {
    workspaceId: Id<"workspaces">;
    chatId: Id<"chats">;
    branchId: Id<"chat_branches">;
    publicId: string;
    role: "system" | "user" | "assistant";
    contentRef: string;
    contentPreview: string;
    runId?: Id<"agent_runs">;
    leaseCapability?: string;
    replyToMessageId?: Id<"messages">;
  }) => Promise<MessageItem>;
  startTurnMutation: (args: {
    workspaceId: Id<"workspaces">;
    chatId: Id<"chats">;
    branchId: Id<"chat_branches">;
    messagePublicId: string;
    runPublicId: string;
    contentRef: string;
    contentPreview: string;
    runtime: "model" | "harness";
    provider: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    fastMode: boolean;
  }) => Promise<StartTurnResult>;
  renewRunLeaseMutation: (args: {
    workspaceId: Id<"workspaces">;
    runId: Id<"agent_runs">;
    leaseCapability: string;
  }) => Promise<{ leaseExpiresAt: number }>;
  handoffRunLeaseMutation: (args: {
    workspaceId: Id<"workspaces">;
    runId: Id<"agent_runs">;
    leaseCapability: string;
  }) => Promise<boolean>;
  cancelRunLeaseMutation: (args: {
    workspacePublicId: string;
    runPublicId: string;
  }) => Promise<RunItem>;
  completeRunMutation: (args: {
    workspaceId: Id<"workspaces">;
    runId: Id<"agent_runs">;
    leaseCapability: string;
    status: "succeeded" | "failed" | "canceled";
    outputMessageId?: Id<"messages">;
    errorCode?: string;
  }) => Promise<RunItem>;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const recoveryOwnerDocumentIdRef = useRef<string>(runLeaseRecoveryDocumentId());
  const ownedRunLeasesRef = useRef(
    new Map<
      string,
      {
        workspaceId: Id<"workspaces">;
        runId: Id<"agent_runs">;
        leaseCapability: string;
      }
    >(),
  );

  const recoverOrphanedRunLeases = useCallback(async () => {
    const storage = browserSessionStorage();
    const now = Date.now();
    await Promise.all(
      claimOrphanedRunLeases(storage, recoveryOwnerDocumentIdRef.current).map(async (lease) => {
        if (lease.leaseExpiresAt <= now) return;
        const canceled = await inputRef.current
          .cancelRunLeaseMutation({
            workspacePublicId: lease.workspacePublicId,
            runPublicId: lease.runPublicId,
          })
          .then(() => true)
          .catch(() => false);
        if (!canceled && lease.leaseExpiresAt > Date.now()) {
          restoreOrphanedRunLease(storage, lease, `retry-${crypto.randomUUID()}`);
        }
      }),
    );
  }, []);

  const handoffOwnedRunLeases = useCallback(async () => {
    await Promise.all(
      [...ownedRunLeasesRef.current.values()].map((lease) =>
        inputRef.current.handoffRunLeaseMutation(lease).catch(() => false),
      ),
    );
  }, []);

  const prepareMessageContent = useCallback(
    async (content: string) => {
      if (!input.workspace || !input.chatId) return null;
      const preview = content.trim().slice(0, sharedConfig.domain.limits.contentPreviewLength);
      if (!preview) return null;
      const envelope = await encodeMessageEnvelope(content);
      const reserved = await input.reserveBlob({
        workspaceId: input.workspace.id,
        backend: input.workspace.storageMode === "local" ? "filesystem" : "r2",
        envelopeVersion: 1,
        contentType: MESSAGE_ENVELOPE_CONTENT_TYPE,
        byteLength: envelope.byteLength,
        sha256: envelope.sha256,
      });
      if (reserved.status !== "available") {
        const attestation = await putRuntimeBlob({
          manifestId: String(reserved.id),
          objectKey: reserved.objectKey,
          backend: reserved.backend,
          data: envelope.data,
          byteLength: envelope.byteLength,
          sha256: envelope.sha256,
        });
        const available = await input.markBlobAvailable({
          workspaceId: input.workspace.id,
          manifestId: reserved.id,
          attestation,
        });
        if (available.status !== "available") {
          throw new Error("Message content did not become available.");
        }
      }
      return { contentRef: reserved.publicId as string, contentPreview: preview };
    },
    [input],
  );

  const persistMessage = useCallback(
    async (message: {
      branchId: string;
      clientId: string;
      role: "system" | "user" | "assistant";
      content: string;
      runId?: Id<"agent_runs">;
      leaseCapability?: string;
      replyToMessageId?: Id<"messages">;
    }): Promise<MessageItem | null> => {
      if (!input.workspace || !input.chatId) return null;
      const prepared = await prepareMessageContent(message.content);
      if (!prepared) return null;
      return input.appendMessage({
        workspaceId: input.workspace.id,
        chatId: input.chatId,
        branchId: message.branchId as Id<"chat_branches">,
        publicId: `message_${message.clientId}`,
        role: message.role,
        ...prepared,
        runId: message.runId,
        leaseCapability: message.leaseCapability,
        replyToMessageId: message.replyToMessageId,
      });
    },
    [input, prepareMessageContent],
  );

  const startTurn = useCallback(
    async (turn: {
      branchId: string;
      messageClientId: string;
      runClientId: string;
      content: string;
      provider: ProviderId;
      model: string;
      reasoningEffort: ReasoningEffort;
      fastMode: boolean;
    }): Promise<StartTurnResult | null> => {
      if (!input.workspace || !input.chatId) return null;
      const prepared = await prepareMessageContent(turn.content);
      if (!prepared) return null;
      const started = await input.startTurnMutation({
        workspaceId: input.workspace.id,
        chatId: input.chatId,
        branchId: turn.branchId as Id<"chat_branches">,
        messagePublicId: `message_${turn.messageClientId}`,
        runPublicId: `run_${turn.runClientId}`,
        ...prepared,
        runtime: turn.provider === "codex" ? "harness" : "model",
        provider: turn.provider,
        model: turn.model,
        reasoningEffort: turn.reasoningEffort,
        fastMode: turn.fastMode,
      });
      ownedRunLeasesRef.current.set(String(started.run.id), {
        workspaceId: input.workspace.id,
        runId: started.run.id,
        leaseCapability: started.leaseCapability,
      });
      rememberOwnedRunLease(browserSessionStorage(), {
        workspacePublicId: input.workspace.publicId,
        runPublicId: started.run.publicId,
        leaseExpiresAt: started.leaseExpiresAt,
      });
      return started;
    },
    [input, prepareMessageContent],
  );

  return useMemo(
    () => ({
      completeRun: async (
        run: RunItem,
        leaseCapability: string,
        status: "succeeded" | "failed" | "canceled",
        outputMessageId?: Id<"messages">,
      ) => {
        if (!input.workspace) return;
        await input
          .completeRunMutation({
            workspaceId: input.workspace.id,
            runId: run.id,
            leaseCapability,
            status,
            outputMessageId,
            ...(status === "failed" ? { errorCode: "runtime_unavailable" } : {}),
          })
          .then(() => {
            ownedRunLeasesRef.current.delete(String(run.id));
            forgetOwnedRunLease(browserSessionStorage(), {
              workspacePublicId: String(input.workspace?.publicId),
              runPublicId: run.publicId,
            });
          });
      },
      persistMessage,
      handoffOwnedRunLeases,
      recoverOrphanedRunLeases,
      renewRunLease: async (run: RunItem, leaseCapability: string) => {
        if (!input.workspace) return null;
        const renewed = await input.renewRunLeaseMutation({
          workspaceId: input.workspace.id,
          runId: run.id,
          leaseCapability,
        });
        rememberOwnedRunLease(browserSessionStorage(), {
          workspacePublicId: input.workspace.publicId,
          runPublicId: run.publicId,
          leaseExpiresAt: renewed.leaseExpiresAt,
        });
        return renewed;
      },
      startTurn,
    }),
    [handoffOwnedRunLeases, input, persistMessage, recoverOrphanedRunLeases, startTurn],
  );
}
