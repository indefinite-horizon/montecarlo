/** Composes the default runtime and exposes its embeddable server API. */

import { pathToFileURL } from "node:url";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";
import { createDefaultRegistry } from "./providers/index.js";
import { RuntimeServer } from "./server.js";
import { createObjectStores } from "./storage/index.js";

export * from "./config.js";
export * from "./registry.js";
export * from "./server.js";
export * from "./storage/index.js";
export * from "./types.js";
export * from "./validation.js";

export function createDefaultRuntime(
  env: NodeJS.ProcessEnv = process.env,
  config: RuntimeConfig = loadRuntimeConfig(env),
): RuntimeServer {
  return new RuntimeServer({
    config,
    registry: createDefaultRegistry(env),
    objectStores: createObjectStores(env),
  });
}

async function main(): Promise<void> {
  const runtime = createDefaultRuntime();
  const address = await runtime.listen();
  process.stdout.write(`Monte Carlo runtime listening on ${address.url}\n`);

  const shutdown = () => {
    void runtime.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Runtime startup failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
