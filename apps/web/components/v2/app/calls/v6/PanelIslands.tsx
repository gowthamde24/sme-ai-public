"use client";

import { MessageCircle, Pause, Phone, Play } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { QuoteOutcome } from "@/components/v2/app/ds/QuoteOutcome";
import { TeachThis, type TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { OutcomeCard } from "@/lib/calls/outcome-card";
import { clockShort } from "@/lib/calls/format";

import { makeT, type Words } from "../../words";
import type { LiveControlsProps } from "./LiveControls";
import { LiveControls } from "./LazyLive";

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

const pad = "px-[18px]";
const b2 = "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";

/**
 * Everything under a call's summary in the right panel (approved mock), as one chunk of its own: the outcome card (a quote with Change / Approve & send, a booked visit, a call back), the recording player, the transcript as bubbles (the assistant's peach on the left, the caller's grey
 * on the right) with "Teach this" under every line the ASSISTANT said, and the buttons (Call back, WhatsApp, Open customer); for a live call the live controls. What is mocked on staging: the recording (calls are not recorded; the player is a sample), and "Call back" (it only notes the
 * wish). "WhatsApp" opens the customer's chat here (or, for an approved quote, the quote's own "Open in WhatsApp" route): no number is in this file.
 */
export function PanelIslands(p: IslandsProps) {
  const t = makeT(p.words);
  return (
    <div className="flex flex-col" data-part="call-islands">
      {p.live && p.liveControls ? (
        <div className={`${pad} pt-4`}>
          <LiveControls words={p.words} {...p.liveControls} />
        </div>
      ) : null}
      {!p.live ? <Outcome p={p} /> : null}
      {!p.live ? <Recording words={p.words} seconds={p.seconds} /> : null}
      <section aria-label={t(p.live ? "calls6.tr.live" : "calls6.tr.title")} className={`${pad} flex flex-col gap-2 py-3`} data-part="call-transcript">
        {p.live ? <h3 className="m-0 text-xs font-bold text-muted">{t("calls6.tr.live")}</h3> : null}
        {p.lines === null && !p.canRead ? (
          <p className="m-0 text-sm text-muted">{t("ph.captions.hidden")}</p>
        ) : p.lines === null || p.lines.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t("ph.captions.none")}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-[1.45]" aria-live={p.live ? "polite" : undefined}>
            {p.lines.map((l, i) => (
              <li key={i} data-who={l.who} className={`flex flex-col ${l.who === "caller" ? "items-end" : "items-start"}`}>
                <span className="sr-only">{l.who === "assistant" ? t("calls6.tr.assistant") : p.speaker}</span>
                <span lang={l.who === "caller" && p.language ? p.language : undefined} className={`max-w-[86%] px-3 py-[9px] text-ink [overflow-wrap:break-word] ${l.who === "assistant" ? "rounded-[12px_12px_12px_4px] bg-brand-bg" : "rounded-[12px_12px_4px_12px] bg-surface-2"}`}>
                  {l.text}
                </span>
                {l.textEn ? (
                  <span lang="en" className="mt-0.5 max-w-[86%] text-xs text-muted [overflow-wrap:break-word]">
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
  const box = `${pad} pt-3.5`;
  if (o.kind === "visit") {
    const when = p.whenText ?? o.day;
    return (
      <section className={box} data-part="call-outcome" data-outcome="visit" aria-label={t("calls6.outcome.title")}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface p-3">
          <p className="m-0 text-[15px] font-bold text-ink">{when ? t("calls6.outcome.visit.when", { when }) : t("calls6.outcome.visit")}</p>
          <Link href={`${p.base}/visits`} className={`${b2} flex-none`}>
            {t("calls6.outcome.visit.open")}
          </Link>
        </div>
      </section>
    );
  }
  if (o.kind === "callback")
    return (
      <section className={box} data-part="call-outcome" data-outcome="callback" aria-label={t("calls6.outcome.title")}>
        <p className="m-0 rounded-[14px] border border-line bg-surface p-3 text-[15px] font-bold text-ink">{p.whenText ? t("calls6.outcome.callback.when", { when: p.whenText }) : t("calls6.outcome.callback")}</p>
      </section>
    );
  return (
    <section className={box} data-part="call-outcome" data-outcome="quote" aria-label={t("calls6.outcome.title")}>
      <QuoteOutcome words={p.words} base={p.base} quote={o} approve={p.approve} />
    </section>
  );
}

/** A SAMPLE player: calls are not recorded today (docs/contracts/calls.md), so there is nothing to hear. It shows the round play button, the bar and the length the recording would have ("1:28 / 4:12"), moving while "playing", and says so. No audio, no request. */
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
    <section className={`${pad} flex flex-col gap-1 pt-3.5`} data-part="call-recording" aria-label={t("calls6.rec.title")}>
      <div className="flex items-center gap-2.5 text-xs text-muted">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("calls6.rec.pause") : t("calls6.rec.play")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full">
          <span className="inline-flex size-[30px] items-center justify-center rounded-full bg-brand text-on-brand">{playing ? <Pause aria-hidden="true" className="size-3.5" /> : <Play aria-hidden="true" className="size-3.5" />}</span>
        </button>
        <progress max={total} value={at} aria-label={t("calls6.rec.title")} className="h-1 min-w-0 flex-1 accent-brand" />
        <span className="tabular-nums">
          {clockShort(at)} / {clockShort(total)}
        </span>
      </div>
      <p className="m-0 text-xs text-muted">{t("calls6.rec.note")}</p>
    </section>
  );
}

function Buttons({ p }: { p: IslandsProps }) {
  const t = makeT(p.words);
  const [noted, setNoted] = React.useState(false);
  const chat = p.leadId ? `${p.base}/chats/${p.leadId}` : null;
  return (
    <div className={`${pad} flex flex-col gap-2 pb-4`} data-part="call-actions">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setNoted(true)} disabled={noted} className={b2}>
          <Phone aria-hidden="true" className="size-4" />
          {t("calls6.act.callback")}
        </button>
        {chat ? (
          <Link href={chat} className={b2}>
            <MessageCircle aria-hidden="true" className="size-4" />
            {t("calls6.act.whatsapp")}
          </Link>
        ) : null}
        {p.leadId ? (
          <Link href={`${p.base}/customers/${p.leadId}`} className={b2} data-part="call-customer">
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
