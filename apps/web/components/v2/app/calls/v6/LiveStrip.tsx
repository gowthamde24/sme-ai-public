"use client";

import { Headphones } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { clockShort } from "@/lib/calls/format";

import { makeT, type Words } from "../../words";

export type LiveCall = { id: string; who: string; direction: "inbound" | "outbound"; elapsedS: number; answered: boolean; href: string };

/**
 * The live strip at the top of the Calls page (approved mock): one white row, the real circle, "N live now", under it each caller as "Meena · outbound · 1:24" with a timer that counts on, then Listen and "Open Meena" (the first live call; the other names are links).
 * Drawn only when calls are live. The timers count on from the API's own seconds, once a second while the tab is in view. "Listen" is a sample on staging (the API has no way to hear a call yet): it says it would be listening, and plays nothing.
 */
export function LiveStrip({ words, calls }: { words: Words; calls: readonly LiveCall[] }) {
  const t = makeT(words);
  const [since, setSince] = React.useState(0);
  const [listening, setListening] = React.useState(false);
  React.useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setSince(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  if (calls.length === 0) return null;
  const first = calls[0];
  return (
    <section aria-label={t("calls6.live.title", { n: calls.length })} data-part="live-strip" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--v2-shadow)]">
      <Orb px={44} state="listen" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-bold" role="status">
          {t("calls6.live.title", { n: calls.length })}
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[13px] text-muted">
          {calls.map((c) => (
            <li key={c.id} data-live-call={c.id}>
              <Link href={c.href} scroll={false} className="hover:underline">
                {c.who}
              </Link>
              {" · "}
              {t(c.direction === "outbound" ? "calls6.dir.outbound" : "calls6.dir.incoming")}
              {" · "}
              <span className="tabular-nums">{c.answered ? clockShort(c.elapsedS + since) : t("ph.state.ringing")}</span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" aria-pressed={listening} onClick={() => setListening((l) => !l)} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 aria-pressed:border-brand-edge aria-pressed:bg-brand-bg aria-pressed:text-brand-text">
        <Headphones aria-hidden="true" className="size-4" />
        {listening ? t("calls6.live.listening") : t("calls6.live.listen")}
      </button>
      <Link href={first.href} scroll={false} className="inline-flex min-h-11 items-center rounded-[10px] bg-brand px-3.5 text-[13px] font-bold text-on-brand">
        {t("calls6.live.open_name", { name: first.who })}
      </Link>
      {listening ? (
        <p role="status" className="m-0 w-full text-sm text-muted">
          {t("calls6.live.listen.note")}
        </p>
      ) : null}
    </section>
  );
}
