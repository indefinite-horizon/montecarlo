/** Provides an explicit mount-only effect hook. */

import { type EffectCallback, useEffect } from "react";

/**
 * Run a callback exactly once when the component mounts.
 * Equivalent to useEffect(fn, []) but communicates intent explicitly.
 *
 * This is the ONLY approved pattern for mount-time side effects.
 * See .agents/rules/react-no-direct-use-effect.md.
 */
export function useMountEffect(fn: EffectCallback) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally empty deps — mount-only
  useEffect(fn, []);
}
