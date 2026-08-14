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
  type Viewport,
} from "@xyflow/react";
import { ArrowUpRight, GitBranch, LoaderCircle, Quote, Sparkles } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClearCollapsedTextSelection } from "@/hooks/useClearCollapsedTextSelection";
import { useContainedMessageVisibility } from "@/hooks/useContainedMessageVisibility";
import { useTheme } from "@/hooks/useTheme";
import { branchAncestryIds, branchCanvasConfig, layoutBranchCanvas } from "@/lib/branchCanvas";
import {
  type BranchAnchor,
  type ChatBranch,
  type ChatMessage,
  isBranchRunning,
  isThreadOpeningContentReady,
  messageScrollId,
  type SelectionAnchor,
} from "@/lib/conversation";
import { retrySourceForMessage } from "@/lib/messageRetry";
import type { ThreadScrollBookmark } from "@/lib/sessionPresentationMemory";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { SelectionBranchAction } from "./BranchComposer";
import { CanvasMessage } from "./CanvasMessage";
import { FollowUpCanvasNode, type FollowUpComposerNode } from "./FollowUpCanvasNode";
import { ThreadScroller } from "./ThreadScroller";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";

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
  running: boolean;
  contentReady: boolean;
  initialScrollBookmark?: ThreadScrollBookmark;
  pathActive: boolean;
  dimmed: boolean;
  onAskFollowUp: (branchId: string) => void;
  onOpenThread: (branchId: string) => void;
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onReadMessage: (messageId: string) => Promise<boolean>;
  onScrollBookmarkChange?: (bookmark: ThreadScrollBookmark) => void;
  onSelectText: (selection?: CanvasSelection) => void;
  onClearTextSelection: () => void;
  readMessageId?: string;
  readTrackingEnabled: boolean;
};

type BranchNode = Node<BranchNodeData, "branch">;
type ConversationNode = BranchNode | FollowUpComposerNode;
type ConversationEdgeData = { pathActive: boolean; draft?: boolean };
type ConversationEdge = Edge<ConversationEdgeData>;

export type ConversationCanvasProps = {
  branches: ChatBranch[];
  activeBranchId: string;
  activityNow: number;
  initialBranchScrollBookmarks?: ReadonlyMap<string, ThreadScrollBookmark>;
  initialViewport?: ConversationCanvasViewport;
  loading: boolean;
  readMessageId?: string;
  readTrackingEnabled: boolean;
  onReadMessage: (messageId: string) => Promise<boolean>;
  onBranchScrollBookmarkChange?: (branchId: string, bookmark: ThreadScrollBookmark) => void;
  onSelectBranch: (branchId: string) => void;
  onOpenThread: () => void;
  onViewportChange?: (viewport: ConversationCanvasViewport) => void;
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onCreateBranch: (anchor: BranchAnchor, parentBranchId?: string) => Promise<boolean>;
};

export type ConversationCanvasViewport = Viewport;

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
  activityNow,
  initialBranchScrollBookmarks,
  initialViewport,
  loading,
  readMessageId,
  readTrackingEnabled,
  onReadMessage,
  onBranchScrollBookmarkChange,
  onSelectBranch,
  onOpenThread,
  onViewportChange,
  onEditMessage,
  onRetryMessage,
  onCreateBranch,
}: ConversationCanvasProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const {
    rootRef: canvasRef,
    visible: readMessageVisible,
    suspend: suspendReadTracking,
    resume: resumeReadTracking,
  } = useContainedMessageVisibility(readMessageId);
  const [hoveredBranchId, setHoveredBranchId] = useState<string>();
  const [selection, setSelection] = useState<CanvasSelection>();
  const [draft, setDraft] = useState<FollowUpDraft>();
  useClearCollapsedTextSelection(setSelection, !draft);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const draftNodeId = draft ? `follow-up-${draft.parentBranchId}` : undefined;
  const topologySignature = `${[...branches]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((branch) => `${branch.id}:${branch.parentBranchId ?? "root"}`)
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
          selectedText: draft.selection?.sourceText ?? draft.selection?.text,
          displayText: draft.selection?.text,
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
      const branchScrollKey = branch.publicId ?? branch.id;
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
          running: isBranchRunning(branch, activityNow),
          contentReady: branch.openingContentReady ?? isThreadOpeningContentReady(branch.messages),
          initialScrollBookmark: initialBranchScrollBookmarks?.get(branchScrollKey),
          pathActive,
          dimmed: Boolean(hoveredBranchId) && !pathActive,
          onAskFollowUp: (branchId) => openFollowUp(branchId),
          onOpenThread: openThread,
          onEditMessage,
          onRetryMessage,
          onReadMessage,
          onScrollBookmarkChange: onBranchScrollBookmarkChange
            ? (bookmark) => onBranchScrollBookmarkChange(branchScrollKey, bookmark)
            : undefined,
          onSelectText: setSelection,
          onClearTextSelection: clearTextSelection,
          readMessageId: branch.id === activeBranchId ? readMessageId : undefined,
          readTrackingEnabled: readTrackingEnabled && readMessageVisible,
        },
      };
    });

    if (!draft) return branchNodes;
    const composerId = draftNodeId ?? `follow-up-${draft.parentBranchId}`;
    const composerNode: FollowUpComposerNode = {
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
      ariaLabel: t("branch.askFollowUp"),
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
    activityNow,
    branches,
    clearTextSelection,
    closeFollowUp,
    draft,
    draftNodeId,
    hoveredBranchId,
    initialBranchScrollBookmarks,
    openFollowUp,
    openThread,
    onBranchScrollBookmarkChange,
    onReadMessage,
    onEditMessage,
    onRetryMessage,
    pathBranchIds,
    positions,
    readMessageId,
    readMessageVisible,
    readTrackingEnabled,
    submitFollowUp,
    t,
  ]);

  const edges = useMemo<ConversationEdge[]>(() => {
    const branchEdges = branches.flatMap((branch) => {
      if (!branch.parentBranchId) return [];
      const pathActive = pathBranchIds.has(branch.parentBranchId) && pathBranchIds.has(branch.id);
      const running = isBranchRunning(branch, activityNow);
      return [
        {
          id: `${branch.parentBranchId}-${branch.id}`,
          source: branch.parentBranchId,
          target: branch.id,
          data: { pathActive },
          animated: running,
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
  }, [activityNow, branches, draft, hoveredBranchId, pathBranchIds]);

  return (
    <section
      ref={canvasRef}
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
        defaultViewport={initialViewport}
        fitView={!initialViewport}
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
          suspendReadTracking();
          if (event) clearTextSelection();
        }}
        onMoveEnd={(_, viewport) => {
          resumeReadTracking();
          onViewportChange?.(viewport);
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
      </ReactFlow>

      {loading ? (
        <div
          role="status"
          data-testid="canvas-loading"
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
  const turnCount = branch.messages.filter((message) => message.role === "user").length;

  return (
    <article
      aria-label={branch.title}
      aria-busy={data.running}
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
        <ActionTooltip label={t("canvas.openThread", { title: branch.title })} side="left">
          <Button
            className="nodrag nopan opacity-70 transition-opacity hover:opacity-100"
            size="icon"
            variant="ghost"
            aria-label={t("canvas.openThread", { title: branch.title })}
            onClick={() => data.onOpenThread(branch.id)}
          >
            <ArrowUpRight />
          </Button>
        </ActionTooltip>
      </header>

      <ThreadScroller
        ariaLabel={t("canvas.branchMessages", { title: branch.title })}
        buttonClassName="nowheel nodrag nopan size-7"
        contentClassName="gap-0"
        contentReady={data.contentReady}
        initialScrollBookmark={data.initialScrollBookmark}
        onScroll={data.onClearTextSelection}
        onReadMessage={data.onReadMessage}
        onScrollBookmarkChange={data.onScrollBookmarkChange}
        readMessageId={data.readMessageId}
        readTrackingEnabled={data.readTrackingEnabled}
        streaming={data.running}
        threadId={branch.publicId ?? branch.id}
        viewportClassName="nowheel nodrag nopan"
      >
        {branch.anchor?.selectedText ? (
          <MessageScrollerItem messageId={`branch-context-${branch.publicId ?? branch.id}`}>
            <div className="border-b border-border/70 bg-accent/35 px-4 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-primary">
                <Quote className="size-3" />
                {t("branch.selectedPassage")}
              </div>
              <blockquote className="line-clamp-3 font-display text-[12px] italic leading-5 text-foreground/75">
                “{branch.anchor.displayText ?? branch.anchor.selectedText}”
              </blockquote>
            </div>
          </MessageScrollerItem>
        ) : null}

        <MessageScrollerItem
          aria-hidden={branch.messages.length ? "true" : undefined}
          className="grid min-h-52 place-items-center px-8 text-center"
          hidden={branch.messages.length > 0}
          messageId={`branch-empty-${branch.publicId ?? branch.id}`}
        >
          <span className="text-xs font-medium text-muted-foreground">
            {t("canvas.emptyBranch")}
          </span>
        </MessageScrollerItem>
        {branch.messages.map((message, index) => {
          const retrySource = retrySourceForMessage(branch.messages, index);
          return (
            <MessageScrollerItem
              key={messageScrollId(message)}
              className={message.isStreaming ? "[overflow-anchor:none]" : undefined}
              messageId={messageScrollId(message)}
              scrollAnchor={message.role === "user"}
            >
              <CanvasMessage
                actionsDisabled={data.running}
                message={message}
                onEdit={
                  message.role === "user"
                    ? (content) => data.onEditMessage(message, content)
                    : undefined
                }
                onRetry={retrySource ? () => data.onRetryMessage(retrySource) : undefined}
                onSelectText={(anchor) =>
                  data.onSelectText(anchor ? { branchId: branch.id, anchor } : undefined)
                }
              />
            </MessageScrollerItem>
          );
        })}
      </ThreadScroller>

      <footer className="flex min-h-14 items-center justify-center border-t border-border/80 bg-card/95 px-4">
        <Button
          data-testid="canvas-ask-follow-up"
          className="nodrag nopan rounded-full"
          size="sm"
          variant="outline"
          disabled={data.running}
          onClick={() => data.onAskFollowUp(branch.id)}
        >
          <Sparkles />
          {t("branch.askFollowUp")}
        </Button>
      </footer>
    </article>
  );
});

const nodeTypes = {
  branch: BranchCanvasNode,
  composer: FollowUpCanvasNode,
} satisfies NodeTypes;
