"use client";

import { Check, CircleHelp, Minus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { PlushStill } from "@/components/v2/app/owl/PlushStill";

import type { AskWords } from "./ask-words";

const CAN = ["ask.can.y1", "ask.can.y2", "ask.can.y3", "ask.can.y4"] as const;
const CANNOT = ["ask.can.n1", "ask.can.n2", "ask.can.n3", "ask.can.n4"] as const;

/**
 * "What can Agent OWL do?" (job BT): a button under the Ask box that opens a short card in the page's own flow: what it can do (read your records, find a saree, write a draft for you to check), what it
 * cannot (change records or prices, send or approve from this box, answer from outside your records, decide for you), three questions to try (tap one to ask it) and a link to the guide. The words come
 * with the Ask box (ask-words.ts). It sends nothing and remembers nothing.
 */
export function AskCapabilities({ w, examples, onTry, guideHref }: { w: (key: string) => string; examples: readonly string[]; onTry: (question: string) => void; guideHref: string }) {
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
    <div data-ask-can="sheet" className="mt-3 flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2 aria-expanded:border-brand-edge aria-expanded:bg-brand-bg"
      >
        <CircleHelp className="size-5 text-brand-text" aria-hidden="true" />
        {w("ask.can.button")}
      </button>
      {open ? (
        <section id={id} aria-label={w("ask.can.title")} className="w-full rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5">
          <div className="flex items-start gap-3">
            <PlushStill px={48} mood="answering" className="size-12" />
            <h3 className="min-w-0 flex-1 pt-1 font-display text-xl font-semibold leading-tight">{w("ask.can.title")}</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label={w("ask.can.close")} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <h4 className="text-base font-semibold">{w("ask.can.yes")}</h4>
              <ul className="mt-2 space-y-2">
                {CAN.map((k) => (
                  <li key={k} className="flex gap-2 text-base">
                    <Check className="mt-0.5 size-5 shrink-0 text-green-text" aria-hidden="true" />
                    {w(k)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-base font-semibold">{w("ask.can.no")}</h4>
              <ul className="mt-2 space-y-2">
                {CANNOT.map((k) => (
                  <li key={k} className="flex gap-2 text-base">
                    <Minus className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                    {w(k)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-5">
            <h4 className="text-base font-semibold">{w("ask.can.try")}</h4>
            <ul className="mt-2 flex flex-wrap gap-2">
              {examples.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onTry(q);
                    }}
                    className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Link href={guideHref} className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-brand-text underline">
            {w("ask.can.guide")}
          </Link>
        </section>
      ) : null}
    </div>
  );
}

export type { AskWords };
