/** Serializes normalized runtime events as SSE or newline-delimited JSON. */

import type { ServerResponse } from "node:http";

export type StreamFormat = "sse" | "jsonl";

export class EventStreamWriter {
  private readonly response: ServerResponse;
  private readonly format: StreamFormat;

  constructor(response: ServerResponse, format: StreamFormat) {
    this.response = response;
    this.format = format;

    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      format === "sse" ? "text/event-stream; charset=utf-8" : "application/x-ndjson; charset=utf-8",
    );
    response.setHeader("Connection", "keep-alive");
    if (format === "sse") response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
  }

  async write<T extends { type: string }>(event: T): Promise<void> {
    if (this.response.destroyed) return;
    const json = JSON.stringify(event);
    const chunk = this.format === "sse" ? `event: ${event.type}\ndata: ${json}\n\n` : `${json}\n`;
    if (!this.response.write(chunk)) await this.waitForDrain();
  }

  end(): void {
    if (!this.response.destroyed && !this.response.writableEnded) this.response.end();
  }

  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.response.removeListener("drain", done);
        this.response.removeListener("close", done);
        resolve();
      };
      this.response.once("drain", done);
      this.response.once("close", done);
    });
  }
}
