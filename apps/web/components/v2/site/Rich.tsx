import type { ReactNode } from "react";

/** A sentence with **bold** parts (the names of the workers in "a day with {brand}"): the markers are in the string, so every language marks its own words. */
export function Rich({ text, className = "font-semibold text-ink" }: { text: string; className?: string }): ReactNode {
  return text.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i} className={className}>{part}</strong> : part));
}
