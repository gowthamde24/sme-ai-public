"use client";

import { useState } from "react";

/**
 * The customer's consent to offers (owner, 18 Nov; campaigns S4): one small chip, "Said yes to offers" / "Said no to offers" / "Not asked about offers", on the customer's page header. How it was given (the date, who recorded it, the note) shows on hover and on a tap
 * (a phone has no hover): the same text, in a line under the chip. The words are the shop's, already in the person's language. Service messages are never touched by this.
 */
export function ConsentChip({ state, label, how, hint }: { state: "granted" | "withdrawn" | "unknown"; label: string; how: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const tone = state === "granted" ? "border-green-text bg-green-bg text-green-text" : state === "withdrawn" ? "border-red-text bg-red-bg text-red-text" : "border-line bg-surface-2 text-muted";
  return (
    <div className="mt-1 flex flex-col items-start gap-1" data-part="consent-chip" data-state={state}>
      <button type="button" title={how} aria-label={`${label}. ${hint}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${tone}`}>
        {label}
      </button>
      {open ? (
        <p role="status" className="m-0 text-sm text-muted" data-part="consent-how">
          {how}
        </p>
      ) : null}
    </div>
  );
}
