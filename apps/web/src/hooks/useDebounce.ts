/** Provides a debounced value hook for delayed UI reactions. */

import { useEffect, useState } from "react";

/**
 * Returns a debounced version of the given value.
 * The returned value only updates after the specified delay
 * has elapsed since the last change.
 *
 * See .agents/rules/react-no-direct-use-effect.md — replaces manual setTimeout/clearTimeout patterns.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  // lint-allow: no-direct-use-effect — core debounce implementation
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
