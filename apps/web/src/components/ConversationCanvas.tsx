/** Spatial, selectable view of every branch and its branch-local conversation turns. */

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { ArrowUpRight, GitBranch, LoaderCircle, Quote, Sparkles } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { branchAncestryIds, branchCanvasConfig, layoutBranchCanvas } from "@/lib/branchCanvas";
import type { BranchAnchor, ChatBranch, ChatMessage, SelectionAnchor } from "@/lib/conversation";
import { selectionAnchorFromMessage } from "@/lib/messageSelection";
import { cn } from "@/lib/utils";
import { SelectionBranchAction } from "./BranchComposer";
import { CanvasStreamingState } from "./CanvasStreamingState";
import { Button } from "./ui/button";

type CanvasSelection = {
  branchId: string;
  anchor: SelectionAnchor;
};

type FollowUpDraft = {
  parentBranchId: string;
  selection?: SelectionAnchor;
};

type BranchNodeData = {
  branch: ChatBranch;
  active: boolean;
  pathActive: boolean;
  dimmed: boolean;
  onAskFollowUp: (branchId: string) => void;
  onOpenThread: (branchId: string) => void;
  onSelectText: (selection: CanvasSelection) => void;
  onClearTextSelection: () => void;
};

type ComposerNodeData = {
  selection?: SelectionAnchor;
  onCancel: () => void;
  onSubmit: (prompt: string) => Promise<void>;
};

type BranchNode = Node<BranchNodeData, "branch">;
type ComposerNode = Node<ComposerNodeData, "composer">;
type ConversationNode = BranchNode | ComposerNode;
type ConversationEdgeData = { pathActive: boolean; draft?: boolean };
type ConversationEdge = Edge<ConversationEdgeData>;

export type ConversationCanvasProps = {
  branches: ChatBranch[];
  activeBranchId: string;
  loading: boolean;
  onSelectBranch: (branchId: string) => void;
  onOpenThread: () => void;
  onCreateBranch: (anchor: BranchAnchor, parentBranchId?: string) => Promise<boolean>;
};

export const ConversationCanvas = memo(function ConversationCanvas(props: ConversationCanvasProps) {
  return (
    <ReactFlowProvider>
      <ConversationCanvasFlow {...props} />
    </ReactFlowProvider>
  );
});

const ConversationCanvasFlow = memo(function ConversationCanvasFlow({
  branches,
  activeBranchId,
  loading,
  onSelectBranch,
  onOpenThread,
  onCreateBranch,
}: ConversationCanvasProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [hoveredBranchId, setHoveredBranchId] = useState<string>();
  const [selection, setSelection] = useState<CanvasSelection>();
  const [draft, setDraft] = useState<FollowUpDraft>();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const draftNodeId = draft ? `follow-up-${draft.parentBranchId}` : undefined;
  const topologySignature = `${branches
    .map((branch) => `${branch.id}:${branch.parentBranchId ?? "root"}:${branch.createdAt}`)
    .join("|")}:${draftNodeId ?? "closed"}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: content updates do not change layout.
  const positions = useMemo(
    () =>
      layoutBranchCanvas(
        branches,
        draft && draftNodeId
          ? { id: draftNodeId, parentBranchId: draft.parentBranchId }
          : undefined,
      ),
    [topologySignature],
  );
  const pathBranchIds = useMemo(
    () => branchAncestryIds(branches, hoveredBranchId ?? activeBranchId),
    [activeBranchId, branches, hoveredBranchId],
  );

  const clearTextSelection = useCallback(() => {
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
  }, []);

  const openFollowUp = useCallback(
    (parentBranchId: string, selectedText?: SelectionAnchor) => {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onSelectBranch(parentBranchId);
      setDraft({ parentBranchId, selection: selectedText });
      setSelection(undefined);
      window.getSelection()?.removeAllRanges();
    },
    [onSelectBranch],
  );

  const closeFollowUp = useCallback(() => {
    const parentBranchId = draft?.parentBranchId;
    setDraft(undefined);
    window.requestAnimationFrame(() => {
      const priorElement = returnFocusRef.current;
      if (priorElement?.isConnected) {
        priorElement.focus();
        return;
      }
      if (!parentBranchId) return;
      const parentNode = document.querySelector<HTMLElement>(
        `[data-branch-id="${CSS.escape(parentBranchId)}"] [data-testid="canvas-ask-follow-up"]`,
      );
      parentNode?.focus();
    });
  }, [draft?.parentBranchId]);

  const openThread = useCallback(
    (branchId: string) => {
      onSelectBranch(branchId);
      clearTextSelection();
      onOpenThread();
    },
    [clearTextSelection, onOpenThread, onSelectBranch],
  );

  const submitFollowUp = useCallback(
    async (prompt: string) => {
      if (!draft) return;
      const created = await onCreateBranch(
        {
          sourceMessageId: draft.selection?.messageId,
          selectedText: draft.selection?.text,
          selectionStart: draft.selection?.start,
          selectionEnd: draft.selection?.end,
          prompt,
        },
        draft.parentBranchId,
      );
      if (created) closeFollowUp();
    },
    [closeFollowUp, draft, onCreateBranch],
  );

  const nodes = useMemo<ConversationNode[]>(() => {
    const branchNodes: BranchNode[] = branches.map((branch) => {
      const pathActive = pathBranchIds.has(branch.id);
      return {
        id: branch.id,
        type: "branch",
        position: positions.get(branch.id) ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        handles: [
          {
            type: "target",
            position: Position.Left,
            x: -branchCanvasConfig.handle.size / 2,
            y: (branchCanvasConfig.card.height - branchCanvasConfig.handle.size) / 2,
            width: branchCanvasConfig.handle.size,
            height: branchCanvasConfig.handle.size,
          },
          {
            type: "source",
            position: Position.Right,
            x: branchCanvasConfig.card.width - branchCanvasConfig.handle.size / 2,
            y: (branchCanvasConfig.card.height - branchCanvasConfig.handle.size) / 2,
            width: branchCanvasConfig.handle.size,
            height: branchCanvasConfig.handle.size,
          },
        ],
        draggable: false,
        selectable: false,
        focusable: false,
        ariaLabel: t("canvas.branchCard", { title: branch.title }),
        domAttributes: {
          "data-testid": "canvas-branch-node",
          "data-branch-id": branch.id,
          "data-path-active": pathActive ? "true" : "false",
        } as NonNullable<BranchNode["domAttributes"]>,
        width: branchCanvasConfig.card.width,
        height: branchCanvasConfig.card.height,
        style: {
          width: branchCanvasConfig.card.width,
          height: branchCanvasConfig.card.height,
        },
        data: {
          branch,
          active: branch.id === activeBranchId,
          pathActive,
          dimmed: Boolean(hoveredBranchId) && !pathActive,
          onAskFollowUp: (branchId) => openFollowUp(branchId),
          onOpenThread: openThread,
          onSelectText: setSelection,
          onClearTextSelection: clearTextSelection,
        },
      };
    });

    if (!draft) return branchNodes;
    const composerId = draftNodeId ?? `follow-up-${draft.parentBranchId}`;
    const composerNode: ComposerNode = {
      id: composerId,
      type: "composer",
      position: positions.get(composerId) ?? { x: 0, y: 0 },
      targetPosition: Position.Left,
      handles: [
        {
          type: "target",
          position: Position.Left,
          x: -branchCanvasConfig.handle.size / 2,
          y: (branchCanvasConfig.composer.height - branchCanvasConfig.handle.size) / 2,
          width: branchCanvasConfig.handle.size,
          height: branchCanvasConfig.handle.size,
        },
      ],
      draggable: false,
      selectable: false,
      focusable: false,
      ariaLabel: t("canvas.followUpDialog"),
      width: branchCanvasConfig.composer.width,
      height: branchCanvasConfig.composer.height,
      style: {
        width: branchCanvasConfig.composer.width,
        height: branchCanvasConfig.composer.height,
      },
      data: {
        selection: draft.selection,
        onCancel: closeFollowUp,
        onSubmit: submitFollowUp,
      },
    };
    return [...branchNodes, composerNode];
  }, [
    activeBranchId,
    branches,
    clearTextSelection,
    closeFollowUp,
    draft,
    draftNodeId,
    hoveredBranchId,
    openFollowUp,
    openThread,
    pathBranchIds,
    positions,
    submitFollowUp,
    t,
  ]);

  const edges = useMemo<ConversationEdge[]>(() => {
    const branchEdges = branches.flatMap((branch) => {
      if (!branch.parentBranchId) return [];
      const pathActive = pathBranchIds.has(branch.parentBranchId) && pathBranchIds.has(branch.id);
      const streaming = branch.messages.some((message) => message.isStreaming);
      return [
        {
          id: `${branch.parentBranchId}-${branch.id}`,
          source: branch.parentBranchId,
          target: branch.id,
          data: { pathActive },
          animated: streaming,
          focusable: false,
          selectable: false,
          className: pathActive ? "canvas-edge--active" : "canvas-edge--muted",
          style: {
            stroke: pathActive ? "hsl(var(--primary))" : "hsl(var(--border))",
            strokeWidth: pathActive ? 2.4 : 1.5,
            opacity: hoveredBranchId && !pathActive ? 0.28 : 0.92,
          },
          domAttributes: {
            "data-testid": "canvas-edge",
            "data-source": branch.parentBranchId,
            "data-target": branch.id,
            "data-path-active": pathActive ? "true" : "false",
          } as NonNullable<ConversationEdge["domAttributes"]>,
        },
      ];
    });

    if (!draft) return branchEdges;
    return [
      ...branchEdges,
      {
        id: `${draft.parentBranchId}-follow-up-draft`,
        source: draft.parentBranchId,
        target: `follow-up-${draft.parentBranchId}`,
        data: { pathActive: false, draft: true },
        animated: true,
        focusable: false,
        selectable: false,
        className: "canvas-edge--draft",
        style: {
          stroke: "hsl(var(--branch-blue))",
          strokeDasharray: "7 7",
          strokeWidth: 1.8,
        },
        domAttributes: {
          "data-testid": "canvas-edge",
          "data-source": draft.parentBranchId,
          "data-target": `follow-up-${draft.parentBranchId}`,
          "data-path-active": "false",
        } as NonNullable<ConversationEdge["domAttributes"]>,
      },
    ];
  }, [branches, draft, hoveredBranchId, pathBranchIds]);

  return (
    <section
      aria-label={t("canvas.region")}
      data-testid="conversation-canvas"
      className="relative min-h-0 flex-1 overflow-hidden bg-background"
    >
      <ReactFlow<ConversationNode, ConversationEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        minZoom={0.16}
        maxZoom={1.35}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 0.92 }}
        onNodeClick={(_, node) => {
          if (node.type === "branch") onSelectBranch(node.id);
        }}
        onNodeMouseEnter={(_, node) => {
          if (node.type === "branch") setHoveredBranchId(node.id);
        }}
        onNodeMouseLeave={(_, node) => {
          if (node.type === "branch") setHoveredBranchId(undefined);
        }}
        onMoveStart={(event) => {
          if (event) clearTextSelection();
        }}
        ariaLabelConfig={{
          "controls.ariaLabel": t("canvas.controls"),
          "controls.zoomIn.ariaLabel": t("canvas.zoomIn"),
          "controls.zoomOut.ariaLabel": t("canvas.zoomOut"),
          "controls.fitView.ariaLabel": t("canvas.fitView"),
          "minimap.ariaLabel": t("canvas.minimap"),
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="hsl(var(--border))"
        />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor="hsl(var(--primary))"
          nodeStrokeColor="hsl(var(--card))"
          maskColor="hsl(var(--background) / 0.82)"
        />
        <ViewportSync topologySignature={topologySignature} />
      </ReactFlow>

      {loading ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-4 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur"
        >
          <LoaderCircle className="size-3.5 animate-spin text-primary" />
          {t("canvas.loading")}
        </div>
      ) : null}

      {selection && !draft ? (
        <SelectionBranchAction
          selection={selection.anchor}
          onOpen={() => openFollowUp(selection.branchId, selection.anchor)}
        />
      ) : null}
    </section>
  );
});

const BranchCanvasNode = memo(function BranchCanvasNode({ data }: NodeProps<BranchNode>) {
  const { t } = useTranslation();
  const { branch } = data;
  const streaming = branch.messages.some((message) => message.isStreaming);
  const turnCount = branch.messages.filter((message) => message.role === "user").length;

  return (
    <article
      aria-label={branch.title}
      aria-busy={streaming}
      data-path-active={data.pathActive ? "true" : "false"}
      className={cn(
        "group relative flex h-full w-full flex-col overflow-hidden rounded-[18px] border bg-card shadow-[0_18px_52px_hsl(var(--foreground)/0.09)] transition-[border-color,box-shadow,opacity,transform] duration-200",
        data.active
          ? "border-primary ring-2 ring-primary/20"
          : data.pathActive
            ? "border-primary/55"
            : "border-border",
        data.dimmed && "opacity-45",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-border"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-card !bg-border"
      />

      <header className="flex min-h-16 items-center gap-3 border-b border-border/80 bg-card/95 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
          <GitBranch className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[16px] font-bold tracking-[-0.01em]">
              {branch.title}
            </h2>
            {data.active ? (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.11em] text-primary-foreground">
                {t("canvas.active")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {t("branch.turnCount", { count: turnCount })}
          </p>
        </div>
        <Button
          className="nodrag nopan opacity-70 transition-opacity hover:opacity-100"
          size="icon"
          variant="ghost"
          aria-label={t("canvas.openThread", { title: branch.title })}
          onClick={() => data.onOpenThread(branch.id)}
        >
          <ArrowUpRight />
        </Button>
      </header>

      <div
        className="nowheel nodrag nopan min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={data.onClearTextSelection}
      >
        {branch.anchor?.selectedText ? (
          <div className="border-b border-border/70 bg-accent/35 px-4 py-3">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-primary">
              <Quote className="size-3" />
              {t("branch.selectedPassage")}
            </div>
            <blockquote className="line-clamp-3 font-display text-[12px] italic leading-5 text-foreground/75">
              “{branch.anchor.selectedText}”
            </blockquote>
          </div>
        ) : null}

        {branch.messages.length ? (
          branch.messages.map((message) => (
            <CanvasMessage
              key={message.id}
              message={message}
              onSelectText={(anchor) => data.onSelectText({ branchId: branch.id, anchor })}
            />
          ))
        ) : (
          <div className="grid min-h-52 place-items-center px-8 text-center">
            <span className="text-xs font-medium text-muted-foreground">
              {t("canvas.emptyBranch")}
            </span>
          </div>
        )}
      </div>

      <footer className="flex min-h-14 items-center justify-center border-t border-border/80 bg-card/95 px-4">
        <Button
          data-testid="canvas-ask-follow-up"
          className="nodrag nopan rounded-full"
          size="sm"
          variant="outline"
          disabled={streaming}
          onClick={() => data.onAskFollowUp(branch.id)}
        >
          <Sparkles />
          {t("canvas.askFollowUp")}
        </Button>
      </footer>
    </article>
  );
});

const CanvasMessage = memo(function CanvasMessage({
  message,
  onSelectText,
}: {
  message: ChatMessage;
  onSelectText: (anchor: SelectionAnchor) => void;
}) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <section className="border-b border-border/60 bg-secondary/35 px-4 py-3.5">
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
          {t("chat.you")}
        </p>
        <p className="whitespace-pre-wrap font-display text-[14px] font-semibold leading-[1.5]">
          {message.content}
        </p>
      </section>
    );
  }

  if (message.role === "system" || message.isError) {
    return (
      <section className="border-b border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[12px] leading-5 text-foreground/80">
        {message.content}
      </section>
    );
  }

  return (
    <section className="border-b border-border/60 px-4 py-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold">{t("chat.assistant")}</span>
        {message.model ? (
          <span className="truncate rounded-full border border-border px-2 py-0.5 text-[8px] text-muted-foreground">
            {message.model}
          </span>
        ) : null}
      </div>
      {message.content ? (
        <div
          role="document"
          className={cn(
            "message-copy whitespace-pre-wrap select-text text-[12.5px] leading-[1.65] text-foreground/88",
            message.isStreaming && "streaming-caret",
          )}
          onMouseUp={(event) => {
            const anchor = selectionAnchorFromMessage(event.currentTarget, message);
            if (anchor) onSelectText(anchor);
          }}
        >
          {message.content}
        </div>
      ) : null}
      {message.isStreaming && !message.content ? <CanvasStreamingState /> : null}
    </section>
  );
});

const FollowUpCanvasNode = memo(function FollowUpCanvasNode({ data }: NodeProps<ComposerNode>) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRequired = !data.selection;

  // lint-allow: no-direct-use-effect — the newly mounted canvas dialog owns focus.
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  const submit = async () => {
    const value = prompt.trim();
    if ((promptRequired && !value) || submitting) return;
    setSubmitting(true);
    try {
      await data.onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      role="dialog"
      aria-labelledby="canvas-follow-up-title"
      className="flex h-full w-full flex-col overflow-hidden rounded-[18px] border border-primary/45 bg-card shadow-[0_20px_64px_hsl(var(--foreground)/0.14)]"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-branch-blue"
      />
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-primary" />
        <h2 id="canvas-follow-up-title" className="font-display text-sm font-bold">
          {t("canvas.askFollowUp")}
        </h2>
      </header>
      {data.selection ? (
        <blockquote className="mx-3 mt-3 line-clamp-2 rounded-md bg-accent/55 px-3 py-2 font-display text-[11px] italic leading-4 text-foreground/75">
          “{data.selection.text}”
        </blockquote>
      ) : null}
      <label htmlFor="canvas-follow-up-prompt" className="sr-only">
        {t("canvas.promptLabel")}
      </label>
      <textarea
        ref={promptRef}
        id="canvas-follow-up-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            data.onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={4}
        className="nodrag nopan nowheel mx-3 mt-3 min-h-0 flex-1 resize-none rounded-lg border border-input bg-background/55 px-3 py-2.5 text-[12px] leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
        placeholder={t("canvas.promptPlaceholder")}
      />
      <footer className="flex gap-2 p-3">
        <Button className="nodrag nopan flex-1" size="sm" variant="ghost" onClick={data.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          className="nodrag nopan flex-1"
          size="sm"
          disabled={(promptRequired && !prompt.trim()) || submitting}
          onClick={() => void submit()}
        >
          {submitting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {t("canvas.ask")}
        </Button>
      </footer>
    </section>
  );
});

const nodeTypes = {
  branch: BranchCanvasNode,
  composer: FollowUpCanvasNode,
} satisfies NodeTypes;

function ViewportSync({ topologySignature }: { topologySignature: string }) {
  const { fitView } = useReactFlow<ConversationNode, ConversationEdge>();

  // lint-allow: no-direct-use-effect — topology changes need an imperative viewport refit.
  useEffect(() => {
    if (!topologySignature) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.16, maxZoom: 0.92, duration: 320 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, topologySignature]);

  return null;
}
