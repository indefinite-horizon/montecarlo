/** Converts a browser text range into the stable offsets used by branch anchors. */

import type { ChatMessage, SelectionAnchor } from "./conversation";

export const markdownSourceStartAttribute = "data-markdown-source-start";
export const markdownSourceEndAttribute = "data-markdown-source-end";

export function selectionTextWithinMessage(
  content: string,
  start: number,
  text: string,
): string | undefined {
  return Number.isSafeInteger(start) &&
    start >= 0 &&
    text.length >= 1 &&
    text.length <= 2_000 &&
    content.slice(start, start + text.length) === text
    ? text
    : undefined;
}

export function selectionAnchorFromMessage(
  container: HTMLElement,
  message: ChatMessage,
): SelectionAnchor | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return undefined;
  }
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  const rawSelection = range.toString();
  const leadingWhitespace = rawSelection.length - rawSelection.trimStart().length;
  const sourceSelection = rawSelection.trim();
  const displayText = displayTextFromRange(range);
  if (sourceSelection.length < 1 || displayText.length < 1) return undefined;

  const rect = range.getBoundingClientRect();
  const directMarkdownStart = markdownSourceOffset(
    container,
    message.content,
    range.startContainer,
    range.startOffset,
  );
  const directMarkdownEnd = markdownSourceOffset(
    container,
    message.content,
    range.endContainer,
    range.endOffset,
  );
  const sourceElements = sourcePositionElements(container);
  const sourceSegments =
    directMarkdownStart === undefined || directMarkdownEnd === undefined
      ? intersectingSourceSegments(container, message.content, range, sourceElements)
      : [];
  const markdownStart = directMarkdownStart ?? sourceSegments[0]?.start;
  const markdownEnd = directMarkdownEnd ?? sourceSegments.at(-1)?.end;
  if (markdownStart !== undefined && markdownEnd !== undefined && markdownEnd >= markdownStart) {
    const rawSourceText = message.content.slice(markdownStart, markdownEnd);
    const sourceLeadingWhitespace = rawSourceText.length - rawSourceText.trimStart().length;
    const sourceTrailingWhitespace = rawSourceText.length - rawSourceText.trimEnd().length;
    const sourceStart = markdownStart + sourceLeadingWhitespace;
    const sourceEnd = markdownEnd - sourceTrailingWhitespace;
    const sourceText = message.content.slice(sourceStart, sourceEnd);
    const selectedText = selectionTextWithinMessage(message.content, sourceStart, sourceText);
    if (!selectedText) return undefined;
    return {
      messageId: message.id,
      text: displayText,
      sourceText: selectedText,
      start: sourceStart,
      end: sourceStart + selectedText.length,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
  }
  if (sourceElements.length > 0) return undefined;

  const prefix = range.cloneRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + leadingWhitespace;
  const selectedText = selectionTextWithinMessage(message.content, start, sourceSelection);
  if (!selectedText) return undefined;

  return {
    messageId: message.id,
    text: displayText,
    start,
    end: start + selectedText.length,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  };
}

type SourceSegment = { start: number; end: number };
type BoundaryPoint = { node: Node; offset: number };

function sourcePositionElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `[${markdownSourceStartAttribute}][${markdownSourceEndAttribute}]`,
    ),
  );
}

function intersectingSourceSegments(
  container: HTMLElement,
  content: string,
  selectionRange: Range,
  sourceElements: HTMLElement[],
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  for (const sourceElement of sourceElements) {
    if (!selectionRange.intersectsNode(sourceElement)) continue;
    const sourceRange = document.createRange();
    sourceRange.selectNodeContents(sourceElement);
    const start = laterPoint(
      {
        node: selectionRange.startContainer,
        offset: selectionRange.startOffset,
      },
      { node: sourceRange.startContainer, offset: sourceRange.startOffset },
    );
    const end = earlierPoint(
      { node: selectionRange.endContainer, offset: selectionRange.endOffset },
      { node: sourceRange.endContainer, offset: sourceRange.endOffset },
    );
    if (comparePoints(start, end) >= 0) continue;

    const segmentRange = document.createRange();
    segmentRange.setStart(start.node, start.offset);
    segmentRange.setEnd(end.node, end.offset);
    if (segmentRange.toString().length === 0) continue;

    const segmentStart = markdownSourceOffset(container, content, start.node, start.offset);
    const segmentEnd = markdownSourceOffset(container, content, end.node, end.offset);
    if (segmentStart !== undefined && segmentEnd !== undefined && segmentEnd > segmentStart) {
      segments.push({ start: segmentStart, end: segmentEnd });
    }
  }
  return segments;
}

function laterPoint(left: BoundaryPoint, right: BoundaryPoint): BoundaryPoint {
  return comparePoints(left, right) >= 0 ? left : right;
}

function earlierPoint(left: BoundaryPoint, right: BoundaryPoint): BoundaryPoint {
  return comparePoints(left, right) <= 0 ? left : right;
}

function comparePoints(left: BoundaryPoint, right: BoundaryPoint): number {
  const leftRange = document.createRange();
  leftRange.setStart(left.node, left.offset);
  leftRange.collapse(true);
  const rightRange = document.createRange();
  rightRange.setStart(right.node, right.offset);
  rightRange.collapse(true);
  return leftRange.compareBoundaryPoints(Range.START_TO_START, rightRange);
}

const blockElements = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

/** Serializes the selected DOM fragment while preserving visible block boundaries. */
function displayTextFromRange(range: Range): string {
  const chunks: string[] = [];
  const appendBreak = () => {
    if (chunks.length > 0 && !chunks.at(-1)?.endsWith("\n")) chunks.push("\n");
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) {
      for (const child of node.childNodes) visit(child);
      return;
    }

    if (node.tagName === "BR") {
      appendBreak();
      return;
    }
    const block = blockElements.has(node.tagName);
    if (block) appendBreak();
    for (const child of node.childNodes) visit(child);
    if (node.tagName === "TH" || node.tagName === "TD") chunks.push("\t");
    if (block) appendBreak();
  };

  visit(range.cloneContents());
  return chunks
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

function markdownSourceOffset(
  container: HTMLElement,
  content: string,
  boundaryNode: Node,
  boundaryOffset: number,
): number | undefined {
  const boundaryElement =
    boundaryNode.nodeType === Node.ELEMENT_NODE
      ? (boundaryNode as Element)
      : boundaryNode.parentElement;
  const sourceElement = boundaryElement?.closest<HTMLElement>(
    `[${markdownSourceStartAttribute}][${markdownSourceEndAttribute}]`,
  );
  if (!sourceElement || !container.contains(sourceElement)) return undefined;

  const sourceStart = Number(sourceElement.getAttribute(markdownSourceStartAttribute));
  const sourceEnd = Number(sourceElement.getAttribute(markdownSourceEndAttribute));
  if (
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    sourceStart < 0 ||
    sourceEnd < sourceStart ||
    sourceEnd > content.length
  ) {
    return undefined;
  }

  const renderedText = sourceElement.textContent ?? "";
  const offsetRange = document.createRange();
  offsetRange.selectNodeContents(sourceElement);
  try {
    offsetRange.setEnd(boundaryNode, Math.max(0, boundaryOffset));
  } catch {
    return undefined;
  }
  const renderedOffset = Math.min(renderedText.length, offsetRange.toString().length);
  return sourceOffsetForRenderedBoundary(
    content.slice(sourceStart, sourceEnd),
    renderedText,
    renderedOffset,
    sourceStart,
  );
}

function sourceOffsetForRenderedBoundary(
  sourceText: string,
  renderedText: string,
  renderedOffset: number,
  sourceStart: number,
): number | undefined {
  if (sourceText === renderedText) return sourceStart + renderedOffset;

  const renderedWithinSource = sourceText.indexOf(renderedText);
  if (renderedWithinSource >= 0) {
    return sourceStart + renderedWithinSource + renderedOffset;
  }
  if (renderedOffset === 0) return sourceStart;
  if (renderedOffset === renderedText.length) return sourceStart + sourceText.length;

  const renderedPrefix = renderedText.slice(0, renderedOffset);
  const prefixWithinSource = sourceText.indexOf(renderedPrefix);
  if (prefixWithinSource >= 0) {
    return sourceStart + prefixWithinSource + renderedPrefix.length;
  }

  const renderedSuffix = renderedText.slice(renderedOffset);
  const suffixWithinSource = sourceText.lastIndexOf(renderedSuffix);
  return suffixWithinSource >= 0 ? sourceStart + suffixWithinSource : undefined;
}
