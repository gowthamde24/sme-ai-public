import type { ReactNode } from "react";

/** The call and lead statuses, each with ITS colour (design system v6): Completed green, Transferred blue, No answer grey, Rejected red, Spam orange, Live purple. The colours are design/ds.css's `[data-status]` rules, so light and dark come from one place. */
export const STATUSES = ["completed", "transferred", "no_answer", "rejected", "spam", "live"] as const;
export type Status = (typeof STATUSES)[number];

/** A status as a pill: a dot and the word (the word is passed in, in the person's language). The colour is never the only sign: the word is always there. The Live dot pulses unless the person asked for less motion. */
export function StatusPill({ status, children, className = "" }: { status: Status; children: ReactNode; className?: string }) {
  return (
    <span data-status={status} className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-sm font-semibold ${className}`}>
      <span data-dot="" aria-hidden="true" className="size-2 rounded-full bg-current" />
      {children}
    </span>
  );
}
