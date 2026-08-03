/** Provides shared class name and avatar formatting helpers. */

import { twMerge } from "tailwind-merge";
import { type ClassValue, clsx } from "../../../../vendor/clsx";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const tokens = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!tokens.length) return "NA";
  return tokens.map((token) => token[0]?.toUpperCase() ?? "").join("");
}
