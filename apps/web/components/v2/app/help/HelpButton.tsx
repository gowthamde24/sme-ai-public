"use client";

import { CircleHelp, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { OrbMark } from "@/components/v2/app/mark/OrbMark";

import { word, type Labels } from "../labels";
import { useScreenTip } from "./help-store";

/**
 * The "?" in the top bar of every workspace screen (owner 31 Oct): a small icon button that opens the help of the screen you are on (its three lines and the link to the full guide, when the screen has a tip), or the way to the list of guides when it has not. It
 * opens under the button, closes with its own button, Escape or a tap outside, remembers nothing and sends nothing.
 */
export function HelpButton({ base, labels }: { base: string; labels?: Labels }) {
  const tip = useScreenTip();
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const label = tip?.label ?? word(labels, "frame.help", "Help");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <div ref={box} data-help="tip" data-screen-tip={tip?.screen} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line aria-expanded:border-brand-edge aria-expanded:bg-brand-bg"
      >
        <CircleHelp className="size-5 text-brand-text" aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} role="region" aria-label={label} className="absolute right-0 top-full z-[60] mt-2 flex w-[min(26rem,calc(100vw-1.5rem))] gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow-pop)]">
          <OrbMark px={40} mood="answering" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            {tip ? (
              <>
                <ul className="list-disc space-y-1.5 pl-5 text-base marker:text-brand-text">
                  {tip.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <Link href={tip.moreHref} onClick={() => setOpen(false)} className="mt-3 inline-flex min-h-11 items-center text-base font-semibold text-brand-text underline">
                  {tip.moreLabel}
                </Link>
              </>
            ) : (
              <Link href={`${base}/help`} onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text underline">
                {word(labels, "frame.help", "Help")}
              </Link>
            )}
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={tip?.closeLabel ?? word(labels, "notify.close", "Close")} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
