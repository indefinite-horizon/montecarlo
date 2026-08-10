/** Safely renders model-authored CommonMark and GitHub-flavored Markdown. */

import { type ComponentPropsWithoutRef, memo, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownSourceEndAttribute, markdownSourceStartAttribute } from "@/lib/messageSelection";
import { cn } from "@/lib/utils";

type SourcePoint = { offset?: number };
type SourceNode = {
  type: string;
  value?: string;
  position?: { start: SourcePoint; end: SourcePoint };
  children?: SourceNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
};

/**
 * Retains source offsets on rendered text without exposing Markdown syntax.
 * Branch-from-selection uses these spans to resolve DOM ranges back to the
 * provider-neutral source string persisted by the conversation graph.
 */
function rehypeMarkdownSourcePositions() {
  return (tree: SourceNode) => {
    wrapSourceTextNodes(tree);
  };
}

function wrapSourceTextNodes(parent: SourceNode) {
  if (!parent.children) return;

  parent.children = parent.children.map((child) => {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (
      child.type === "text" &&
      child.value !== undefined &&
      start !== undefined &&
      end !== undefined
    ) {
      return {
        type: "element",
        tagName: "span",
        properties: {
          [markdownSourceStartAttribute]: start,
          [markdownSourceEndAttribute]: end,
        },
        children: [child],
        position: child.position,
      };
    }

    wrapSourceTextNodes(child);
    return child;
  });
}

const safeMarkdownUrl: UrlTransform = (url) => defaultUrlTransform(url) || undefined;

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

function MarkdownImage({ alt, node: _node, src, title }: MarkdownImageProps) {
  const { t } = useTranslation();
  if (!src) return alt ? <span>{alt}</span> : null;
  return (
    <a
      className="markdown-image-link"
      href={src}
      rel="noopener noreferrer"
      target="_blank"
      title={title}
    >
      {t("markdown.openImage", { name: alt?.trim() || src })}
    </a>
  );
}

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function MarkdownLink({ children, href, node, ...props }: MarkdownLinkProps) {
  const { t } = useTranslation();
  const imageAlt = findImageAlt(node);
  const opensNewContext = Boolean(href && !href.startsWith("#"));

  if (imageAlt !== undefined) {
    const label = t("markdown.openImage", { name: imageAlt.trim() || href });
    return href ? (
      <a
        {...props}
        className="markdown-image-link"
        href={href}
        rel={opensNewContext ? "noopener noreferrer" : undefined}
        target={opensNewContext ? "_blank" : undefined}
      >
        {label}
      </a>
    ) : (
      <span className="markdown-image-link">{label}</span>
    );
  }

  return (
    <a
      {...props}
      href={href || undefined}
      rel={opensNewContext ? "noopener noreferrer" : undefined}
      target={opensNewContext ? "_blank" : undefined}
    >
      {children}
    </a>
  );
}

function findImageAlt(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const sourceNode = node as SourceNode;
  if (sourceNode.tagName === "img") {
    const alt = sourceNode.properties?.alt;
    return typeof alt === "string" ? alt : "";
  }
  for (const child of sourceNode.children ?? []) {
    const alt = findImageAlt(child);
    if (alt !== undefined) return alt;
  }
  return undefined;
}

const markdownComponents = {
  a: MarkdownLink,
  img: MarkdownImage,
  table({ node: _node, ...props }) {
    return (
      <div className="markdown-table-scroll">
        <table {...props} />
      </div>
    );
  },
} satisfies Components;

type MarkdownMessageProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  content: string;
  streaming?: boolean;
};

export const MarkdownMessage = memo(function MarkdownMessage({
  className,
  content,
  streaming = false,
  ...props
}: MarkdownMessageProps) {
  const renderedContent = useThrottledMarkdownContent(content, streaming);
  const footnotePrefix = `markdown-${useId().replaceAll(":", "")}-`;
  return (
    <div {...props} className={cn("markdown-message message-copy min-w-0", className)} data-ph-mask>
      <MarkdownDocument content={renderedContent} footnotePrefix={footnotePrefix} />
    </div>
  );
});

const MarkdownDocument = memo(function MarkdownDocument({
  content,
  footnotePrefix,
}: {
  content: string;
  footnotePrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <ReactMarkdown
      components={markdownComponents}
      rehypePlugins={[rehypeMarkdownSourcePositions]}
      remarkPlugins={[remarkGfm]}
      remarkRehypeOptions={{
        clobberPrefix: footnotePrefix,
        footnoteBackLabel: (referenceIndex) =>
          t("markdown.backToReference", { reference: referenceIndex + 1 }),
        footnoteLabel: t("markdown.footnotes"),
      }}
      skipHtml
      urlTransform={safeMarkdownUrl}
    >
      {content}
    </ReactMarkdown>
  );
});

/** Caps expensive full-document reparses while token deltas are arriving. */
function useThrottledMarkdownContent(content: string, streaming: boolean): string {
  const [snapshot, setSnapshot] = useState(content);
  const latest = useRef(content);
  const timer = useRef<number | undefined>(undefined);

  // lint-allow: no-direct-use-effect — bridge rapid stream deltas into a bounded render cadence.
  useEffect(() => {
    latest.current = content;
    if (!streaming) {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
      return;
    }
    if (timer.current === undefined) {
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        setSnapshot(latest.current);
      }, 50);
    }
  }, [content, streaming]);

  // lint-allow: no-direct-use-effect — clear the pending browser timer when the message unmounts.
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
    },
    [],
  );

  return streaming ? snapshot : content;
}
