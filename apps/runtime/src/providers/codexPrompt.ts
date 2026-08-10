/** Builds provider-neutral conversation prompts for Codex turns. */

import type { ChatMessage } from "../types.js";

function escapeRoleContent(content: string): string {
  return content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function transcriptPrompt(messages: ChatMessage[]): string {
  return [
    "Continue this conversation. Reply to the final user message.",
    ...messages.map(
      (message) => `<${message.role}>\n${escapeRoleContent(message.content)}\n</${message.role}>`,
    ),
  ].join("\n\n");
}

export function latestUserPrompt(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  throw new Error("A user message is required.");
}
