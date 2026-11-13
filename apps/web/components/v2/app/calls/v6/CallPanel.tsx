import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Orb } from "@/components/v2/Orb";
import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import type { TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { CallDetail } from "@/lib/api/calls";
import type { TimelineItem } from "@/lib/api/customer-timeline";
import { callsHref, type CallsQuery } from "@/lib/calls/filter";
import { outcomeCard } from "@/lib/calls/outcome-card";
import { callSentence, callStatus, sentenceText } from "@/lib/calls/status";
import { callClock, callerNamed, refuseWhy } from "@/lib/calls/view";

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
 * The right panel of the Calls page for one call (design system v6): who and when, its status pill, what happened (the owner's correction first, the assistant's own words beside it), then everything interactive in one lazy chunk (lib above: PanelIslands).
 * A live call gets the live panel: the circle listening, the clock, what is being said, Listen, Whisper, Take over and End. The transcript is the Owner's and Admin's (Sales sees a sentence saying so).
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
  return (
    <aside aria-label={name} data-part="call-panel" data-live={call.live ? "1" : "0"} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5">
      <Link href={callsHref(base, query)} scroll={false} className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-brand-text lg:hidden">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t("calls6.panel.back")}
      </Link>
      <header className="flex items-start gap-3">
        {call.live ? <Orb px={56} state="listen" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-2xl font-semibold leading-tight [overflow-wrap:anywhere]">{name}</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            {[t(call.direction === "inbound" ? "ph.dir.inbound" : "ph.dir.outbound"), language].filter(Boolean).join(" · ")} · <time dateTime={call.createdAt}>{when(call.createdAt)}</time>
            {!call.live && call.elapsedS > 0 ? ` · ${callClock(call.elapsedS)}` : ""}
          </p>
        </div>
        <StatusPill status={status}>{t(`calls6.st.${status}`)}</StatusPill>
      </header>
      {call.live ? (
        <p className="m-0 font-display text-3xl font-bold tabular-nums text-ink" data-part="call-clock">
          {call.answeredAt ? callClock(call.elapsedS) : t(`ph.state.${call.state}`)}
        </p>
      ) : (
        <section aria-labelledby={`sm-${call.id}`} className="flex flex-col gap-2" data-part="call-summary">
          <h3 id={`sm-${call.id}`} className="m-0 text-sm font-bold text-muted">
            {t("calls6.panel.summary")}
          </h3>
          {sentence ? <p className="m-0 text-base font-semibold text-ink">{sentence}</p> : null}
          {summary && summary !== sentence ? <p className="m-0 text-base text-ink [overflow-wrap:anywhere]">{summary}</p> : null}
          {call.correction?.summary ? <p className="m-0 text-xs font-bold text-brand-text">{t("ph.yours")}</p> : null}
          {!sentence && !summary ? <p className="m-0 text-sm text-muted">{t("ph.summary.none")}</p> : null}
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
