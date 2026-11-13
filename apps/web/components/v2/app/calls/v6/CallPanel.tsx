import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Orb } from "@/components/v2/Orb";
import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import type { TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { CallDetail } from "@/lib/api/calls";
import type { TimelineItem } from "@/lib/api/customer-timeline";
import { callsHref, type CallsQuery } from "@/lib/calls/filter";
import { clockShort } from "@/lib/calls/format";
import { outcomeCard } from "@/lib/calls/outcome-card";
import { callSentence, callStatus, sentenceText } from "@/lib/calls/status";
import { callerNamed, refuseWhy } from "@/lib/calls/view";

import { makeT, type Words } from "../../words";
import { PanelIslands } from "./Lazy";
import type { LiveControlsProps } from "./LiveControls";

export type CallPanelProps = {
  words: Words;
  base: string;
  query: CallsQuery;
  call: CallDetail;
  timeline: readonly TimelineItem[] | null;
  when: (iso: string) => string;
  language: string | null;
  canRead: boolean;
  teach: TeachActions | null;
  approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null;
  liveControls: Omit<LiveControlsProps, "words"> | null;
};

/**
 * The right panel of the Calls page for one call (approved mock): the name, "Incoming · 9:42 · 4:12 · Telugu" under it and the status pill at the right; "Summary:" and the words (the owner's correction first); then, in one lazy chunk (PanelIslands), the outcome card
 * (a quote: ₹24,500 with Change and Approve & send), the recording player, the transcript as bubbles with "Teach this" under each line the ASSISTANT said, and Call back, WhatsApp, Open customer. A live call gets the live panel: the circle, the clock, what is being said,
 * Listen, Whisper, Take over and End. The transcript is the Owner's and Admin's (Sales sees a sentence saying so).
 */
export function CallPanel({ words, base, query, call, timeline, when, language, canRead, teach, approve, liveControls }: CallPanelProps) {
  const t = makeT(words);
  const name = call.who || t("ph.dir.inbound");
  const status = callStatus(call);
  const why = (reason: string | null) => words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const sentence = sentenceText(callSentence(call), words, why);
  const named = callerNamed(call.who);
  const speaker = named || /^caller ending\b/i.test(call.who) ? name : t("ph.caller");
  const card = outcomeCard(call, timeline);
  const visitAt = card.kind === "visit" || card.kind === "callback" ? card.at : null;
  const lines = call.transcript ? call.transcript.map((l) => ({ who: l.who, text: l.text, textEn: l.textEn })) : null;
  const summary = call.correction?.summary ?? call.summary ?? call.summaryShort;
  const meta = [t(call.direction === "inbound" ? "calls6.meta.in" : "calls6.meta.out"), when(call.createdAt), call.live ? null : call.elapsedS > 0 ? clockShort(call.durationS ?? call.elapsedS) : null, language, call.sandbox || call.simulated ? t("ph.test") : null].filter(Boolean).join(" · ");
  return (
    <aside aria-label={name} data-part="call-panel" data-live={call.live ? "1" : "0"} className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--v2-shadow)] lg:sticky lg:top-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
      <Link href={callsHref(base, query)} scroll={false} className="inline-flex min-h-11 items-center gap-1 px-4 text-sm font-semibold text-brand-text lg:hidden">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t("calls6.panel.back")}
      </Link>
      <header className="flex items-start gap-3 border-b border-line px-[18px] py-4">
        {call.live ? <Orb px={44} state="listen" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[17px] font-bold leading-tight [overflow-wrap:anywhere]">{name}</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-muted">{meta}</p>
        </div>
        <StatusPill status={status}>{t(`calls6.st.${status}`)}</StatusPill>
      </header>
      {call.live ? (
        <p className="m-0 border-b border-line px-[18px] py-3 font-display text-3xl font-bold tabular-nums text-ink" data-part="call-clock">
          {call.answeredAt ? clockShort(call.elapsedS) : t(`ph.state.${call.state}`)}
        </p>
      ) : (
        <section aria-label={t("calls6.panel.summary")} className="flex flex-col gap-1.5 border-b border-line px-[18px] py-3.5 text-[13.5px] leading-[1.55]" data-part="call-summary">
          {summary || sentence ? (
            <p className="m-0 text-ink [overflow-wrap:anywhere]">
              <b>{t("calls6.panel.summary_label")}:</b> {summary ?? sentence}
            </p>
          ) : (
            <p className="m-0 text-muted">{t("ph.summary.none")}</p>
          )}
          {summary && sentence && summary !== sentence ? <p className="m-0 font-semibold text-ink">{sentence}</p> : null}
          {call.correction?.summary ? <p className="m-0 text-xs font-bold text-brand-text">{t("ph.yours")}</p> : null}
        </section>
      )}
      <PanelIslands
        words={words}
        base={base}
        callId={call.id}
        live={call.live}
        speaker={speaker}
        language={call.language}
        lines={call.live && lines ? lines.slice(-8) : lines}
        canRead={canRead}
        whenText={visitAt ? when(visitAt) : null}
        outcome={card}
        leadId={call.leadId}
        approve={approve}
        teach={teach}
        seconds={call.durationS ?? call.elapsedS}
        liveControls={liveControls}
      />
    </aside>
  );
}
