/** Resolves provider-neutral requests to registered local runners. */

import { HttpError } from "./errors.js";
import type { ProviderId, Runner } from "./types.js";

export class RunnerRegistry {
  private readonly runners = new Map<ProviderId, Runner>();

  constructor(runners: readonly Runner[]) {
    for (const runner of runners) {
      if (this.runners.has(runner.descriptor.id)) {
        throw new Error(`Duplicate runner: ${runner.descriptor.id}`);
      }
      this.runners.set(runner.descriptor.id, runner);
    }
  }

  get(id: ProviderId): Runner {
    const runner = this.runners.get(id);
    if (runner === undefined) {
      throw new HttpError(404, "provider_not_found", "The requested provider is not registered.");
    }
    return runner;
  }

  list(): Runner[] {
    return [...this.runners.values()];
  }
}
