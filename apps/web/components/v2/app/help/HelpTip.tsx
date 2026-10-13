"use client";

import { CircleHelp, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { PlushStill } from "@/components/v2/app/owl/PlushStill";

/**
 * The "?" tip of a screen (job BT): a small button with the words "Help for this screen" that opens three short lines about the screen and a link to its full guide. It opens under the heading, in the page's
 * own flow (nothing floats off a 360 px phone), closes with its own button or Escape, remembers nothing, and sends nothing. The words arrive resolved in the person's language (components/v2/app/help/help-tip.tsx).
 */
export function HelpTip({ screen, label, lines, moreHref, moreLabel, closeLabel }: { screen: string; label: string; lines: readonly string[]; moreHref: string; moreLabel: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div data-help="tip" data-screen-tip={screen} className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2 aria-expanded:border-brand-edge aria-expanded:bg-brand-bg"
      >
        <CircleHelp className="size-5 text-brand-text" aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div id={id} role="region" aria-label={label} className="flex w-full max-w-2xl gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
          <PlushStill px={48} mood="answering" className="size-12" />
          <div className="min-w-0 flex-1">
            <ul className="list-disc space-y-1.5 pl-5 text-base marker:text-brand-text">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <Link href={moreHref} className="mt-3 inline-flex min-h-11 items-center text-base font-semibold text-brand-text underline">
              {moreLabel}
            </Link>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
