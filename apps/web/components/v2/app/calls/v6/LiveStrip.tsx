"use client";

import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { callClock } from "@/lib/calls/view";

import { makeT, type Words } from "../../words";

export type LiveCall = { id: string; who: string; elapsedS: number; answered: boolean; href: string };

/**
 * The live strip at the top of the Calls page (design system v6), drawn only when calls are live: the real circle listening, "N live now", each caller's name with a running timer, and Listen and Open. The timers count on from the API's own seconds (`elapsedS`),
 * once a second while the tab is in view. "Listen" is a sample on staging (the API has no way to hear a call yet): it shows that it would be listening, and plays nothing.
 */
export function LiveStrip({ words, calls }: { words: Words; calls: readonly LiveCall[] }) {
  const t = makeT(words);
  const [since, setSince] = React.useState(0);
  const [listening, setListening] = React.useState<string | null>(null);
  React.useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setSince(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  if (calls.length === 0) return null;
  return (
    <section aria-label={t("calls6.live.title", { n: calls.length })} data-part="live-strip" className="ds-glow flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:gap-5">
      <div className="flex items-center gap-3">
        <Orb px={48} state="listen" />
        <p className="m-0 font-display text-xl font-semibold" role="status">
          {t("calls6.live.title", { n: calls.length })}
        </p>
      </div>
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-2 p-0 md:flex-row md:flex-wrap">
        {calls.map((c) => (
          <li key={c.id} data-live-call={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2">
            <span className="min-w-0 truncate font-semibold text-ink">{c.who}</span>
            <span className="text-sm font-semibold tabular-nums text-brand-text">{c.answered ? callClock(c.elapsedS + since) : t("ph.state.ringing")}</span>
            <button type="button" aria-pressed={listening === c.id} onClick={() => setListening(listening === c.id ? null : c.id)} className="inline-flex min-h-11 items-center rounded-full border border-edge px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 aria-pressed:border-brand-edge aria-pressed:bg-brand-bg aria-pressed:text-brand-text">
              {listening === c.id ? t("calls6.live.listening") : t("calls6.live.listen")}
            </button>
            <Link href={c.href} scroll={false} className="inline-flex min-h-11 items-center rounded-full bg-brand px-3.5 text-sm font-semibold text-on-brand">
              {t("calls6.live.open")}
            </Link>
          </li>
        ))}
      </ul>
      {listening ? (
        <p role="status" className="m-0 text-sm text-muted">
          {t("calls6.live.listen.note")}
        </p>
      ) : null}
    </section>
  );
}
