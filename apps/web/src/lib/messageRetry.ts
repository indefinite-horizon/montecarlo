/** Resolves which durable user turn a retry or edit action should replay. */

import type { ChatMessage } from "./conversation";

/** Returns the user turn that should be replayed for an eligible retry action. */
export function retrySourceForMessage(
  messages: ChatMessage[],
  messageIndex: number,
): ChatMessage | undefined {
  const message = messages[messageIndex];
  if (!message) return undefined;

  if (message.role === "user") {
    if (message.persisted) return message;
    for (let index = messageIndex + 1; index < messages.length; index += 1) {
      const response = messages[index];
      if (!response || response.role === "user") return undefined;
      if (response.role === "assistant") {
        return response.runStatus === "succeeded" ? message : undefined;
      }
    }
    return undefined;
  }

  if (message.role !== "assistant" || message.runStatus !== "succeeded") return undefined;
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const source = messages[index];
    if (source?.role === "user") return source;
  }
  return undefined;
}
