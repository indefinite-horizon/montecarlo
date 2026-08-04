/** Converts a browser text range into the stable offsets used by branch anchors. */

import type { ChatMessage, SelectionAnchor } from "./conversation";

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
  const selectedText = text.slice(0, 2_000);
  if (message.content.slice(start, start + selectedText.length) !== selectedText) {
    return undefined;
  }

  return {
    messageId: message.id,
    text: selectedText,
    start,
    end: start + selectedText.length,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  };
}
