"use client";

import { Pause, Play } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";

import { QuoteOutcome } from "@/components/v2/app/ds/QuoteOutcome";
import { TeachThis, type TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { OutcomeCard } from "@/lib/calls/outcome-card";
import { callClock } from "@/lib/calls/view";

import { btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import type { LiveControlsProps } from "./LiveControls";

const LiveControls = dynamic(() => import("./LiveControls").then((m) => m.LiveControls));

export type Line = { who: "assistant" | "caller"; text: string; textEn: string | null };
export type IslandsProps = {
  words: Words;
  base: string;
  callId: string;
  live: boolean;
  speaker: string;
  language: string | null;
  lines: readonly Line[] | null;
  /** the person may read what is said (Owner, Admin) */
  canRead: boolean;
  /** when the visit or the call-back is, already written in the person's language */
  whenText: string | null;
  outcome: OutcomeCard;
  leadId: string | null;
  /** Owner and Admin: approve the quote the call left. null = the buttons are not drawn. */
  approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null;
  teach: TeachActions | null;
  seconds: number;
  liveControls: Omit<LiveControlsProps, "words"> | null;
};

const card = "rounded-2xl border border-line bg-surface-2 p-4";
const h3 = "m-0 text-sm font-bold text-muted";

/**
 * Everything under a call's summary in the right panel (design system v6), as one chunk of its own: the outcome card (a quote with Change / Approve, a booked visit, a call back), the recording player, the transcript with "Teach this" on every line the ASSISTANT said,
 * the buttons (Call back, WhatsApp, Open customer), and for a live call the live controls. What is mocked on staging: the recording (calls are not recorded; the player is a sample), and "Call back" (it only notes the wish). "WhatsApp" opens the customer's chat
 * here (or, for an approved quote, the quote's own "Open in WhatsApp" route): no number is in this file.
 */
export function PanelIslands(p: IslandsProps) {
  const t = makeT(p.words);
  return (
    <div className="flex flex-col gap-4" data-part="call-islands">
      {p.live && p.liveControls ? <LiveControls words={p.words} {...p.liveControls} /> : null}
      {!p.live ? <Outcome p={p} /> : null}
      {!p.live ? <Recording words={p.words} seconds={p.seconds} /> : null}
      <section aria-labelledby={`tr-${p.callId}`} className="flex flex-col gap-2" data-part="call-transcript">
        <h3 id={`tr-${p.callId}`} className={h3}>
          {t(p.live ? "calls6.tr.live" : "calls6.tr.title")}
        </h3>
        {p.lines === null && !p.canRead ? (
          <p className="m-0 text-sm text-muted">{t("ph.captions.hidden")}</p>
        ) : p.lines === null || p.lines.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t("ph.captions.none")}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-live={p.live ? "polite" : undefined}>
            {p.lines.map((l, i) => (
              <li key={i} data-who={l.who} className={`flex flex-col ${l.who === "caller" ? "items-end text-right" : "items-start"}`}>
                <span className="text-xs font-bold text-muted">{l.who === "assistant" ? t("calls6.tr.assistant") : p.speaker}</span>
                <span lang={l.who === "caller" && p.language ? p.language : undefined} className={`max-w-[92%] rounded-2xl border px-3 py-2 text-base [overflow-wrap:break-word] ${l.who === "assistant" ? "border-brand-edge bg-brand-bg text-ink" : "border-line bg-surface text-ink"}`}>
                  {l.text}
                </span>
                {l.textEn ? (
                  <span lang="en" className="mt-0.5 max-w-[92%] text-sm text-muted [overflow-wrap:break-word]">
                    {l.textEn}
                  </span>
                ) : null}
                {l.who === "assistant" && !p.live ? <TeachThis words={p.words} source="call" sourceId={p.callId} lineIndex={i} line={l.text} actions={p.teach} /> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      {!p.live ? <Buttons p={p} /> : null}
    </div>
  );
}

function Outcome({ p }: { p: IslandsProps }) {
  const t = makeT(p.words);
  const o = p.outcome;
  if (o.kind === "none") return null;
  if (o.kind === "visit") {
    const when = p.whenText ?? o.day;
    return (
      <section className={`${card} flex flex-col gap-2`} data-part="call-outcome" data-outcome="visit">
        <h3 className={h3}>{t("calls6.outcome.title")}</h3>
        <p className="m-0 text-base font-semibold text-ink">{when ? t("calls6.outcome.visit.when", { when }) : t("calls6.outcome.visit")}</p>
        <Link href={`${p.base}/visits`} className={`${btnQuiet} self-start`}>
          {t("calls6.outcome.visit.open")}
        </Link>
      </section>
    );
  }
  if (o.kind === "callback")
    return (
      <section className={`${card} flex flex-col gap-2`} data-part="call-outcome" data-outcome="callback">
        <h3 className={h3}>{t("calls6.outcome.title")}</h3>
        <p className="m-0 text-base font-semibold text-ink">{p.whenText ? t("calls6.outcome.callback.when", { when: p.whenText }) : t("calls6.outcome.callback")}</p>
      </section>
    );
  return (
    <section className={`${card} flex flex-col gap-3`} data-part="call-outcome" data-outcome="quote">
      <h3 className={h3}>{t("calls6.outcome.title")}</h3>
      <QuoteOutcome words={p.words} base={p.base} quote={o} approve={p.approve} />
    </section>
  );
}

/** A SAMPLE player: calls are not recorded today (docs/contracts/calls.md), so there is nothing to hear. It shows the bar and the length the recording would have, moving while "playing", and says so. No audio, no request. */
export function Recording({ words, seconds }: { words: Words; seconds: number }) {
  const t = makeT(words);
  const [playing, setPlaying] = React.useState(false);
  const [at, setAt] = React.useState(0);
  const total = Math.max(1, seconds);
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setAt((a) => (a + 1 >= total ? (setPlaying(false), 0) : a + 1)), 1000);
    return () => clearInterval(id);
  }, [playing, total]);
  return (
    <section className={`${card} flex flex-col gap-2`} data-part="call-recording" aria-label={t("calls6.rec.title")}>
      <h3 className={h3}>{t("calls6.rec.title")}</h3>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("calls6.rec.pause") : t("calls6.rec.play")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
          {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
        </button>
        <progress max={total} value={at} aria-label={t("calls6.rec.title")} className="h-2 min-w-0 flex-1 accent-brand-text" />
        <span className="text-sm tabular-nums text-muted">
          {callClock(at)} / {callClock(total)}
        </span>
      </div>
      <p className="m-0 text-sm text-muted">{t("calls6.rec.note")}</p>
    </section>
  );
}

function Buttons({ p }: { p: IslandsProps }) {
  const t = makeT(p.words);
  const [noted, setNoted] = React.useState(false);
  const chat = p.leadId ? `${p.base}/chats/${p.leadId}` : null;
  return (
    <div className="flex flex-col gap-2" data-part="call-actions">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setNoted(true)} disabled={noted} className={btnQuiet}>
          {t("calls6.act.callback")}
        </button>
        {chat ? (
          <Link href={chat} className={btnQuiet}>
            {t("calls6.act.whatsapp")}
          </Link>
        ) : null}
        {p.leadId ? (
          <Link href={`${p.base}/customers/${p.leadId}`} className={btnQuiet} data-part="call-customer">
            {t("calls6.act.customer")}
          </Link>
        ) : null}
      </div>
      {noted ? (
        <p role="status" className="m-0 text-sm text-muted">
          {t("calls6.act.callback.noted")}
        </p>
      ) : null}
    </div>
  );
}
