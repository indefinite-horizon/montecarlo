/** Converts a browser text range into the stable offsets used by branch anchors. */

import { sharedConfig } from "../../../../lib/config";
import type { ChatMessage, SelectionAnchor } from "./conversation";

export function selectionTextWithinPreview(
  content: string,
  start: number,
  text: string,
): string | undefined {
  const selectableLength = sharedConfig.domain.limits.contentPreviewLength - start;
  if (selectableLength < 3) return undefined;
  const selectedText = text.slice(0, Math.min(2_000, selectableLength));
  return selectedText.length >= 3 &&
    content.slice(start, start + selectedText.length) === selectedText
    ? selectedText
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
  const text = rawSelection.trim();
  if (text.length < 3) return undefined;

  const rect = range.getBoundingClientRect();
  const prefix = range.cloneRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + leadingWhitespace;
  const selectedText = selectionTextWithinPreview(message.content, start, text);
  if (!selectedText) return undefined;

  return {
    messageId: message.id,
    text: selectedText,
    start,
    end: start + selectedText.length,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  };
}
