/** Starts the companion when built as Electron's standalone Node entrypoint. */

import { createDefaultRuntime } from "./index.js";

async function run(): Promise<void> {
  const runtime = createDefaultRuntime();
  const address = await runtime.listen();
  process.stdout.write(`Monte Carlo runtime listening on ${address.url}\n`);

  const shutdown = () => {
    void runtime.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Runtime startup failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
