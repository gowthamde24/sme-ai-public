import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import type { CallDetail } from "@/lib/api/calls";
import { STAGES, callClock, callerNamed, capturedLabel, type Stage } from "@/lib/calls/view";

import { callResult } from "./CallsList";

type W = Readonly<Record<string, string>>;
export type CallViewProps = {
  call: CallDetail;
  base: string;
  w: W;
  when: (iso: string) => string;
  language: string | null;
  /** the customer's steps that are done (from their timeline); null = the call has no customer, or the timeline could not be read: the strip is not drawn */
  stages: ReadonlySet<Stage> | null;
  /** the person may read what is said (Owner, Admin): a missing transcript is then "nothing yet" (C1 #405: a live call answered by another server has none until it ends), not "not yours" */
  canRead: boolean;
  /** wraps what is said with the "Show English" switch (a client island the page hands in; none = the English lines always show) */
  english?: (has: boolean, lines: ReactNode) => ReactNode;
  /** End call (Owner, Admin, while live); Correct it (Owner, Admin, Sales): client islands the page hands in */
  end: ReactNode;
  correct: ReactNode;
};

const card = "rounded-[22px] border border-line bg-surface p-4 md:p-5";

/**
 * One call (app v4 part 4, from app-Call.png; GET /calls/{id}). While it is live: the assistant's orb with the call's clock, what is being said (the newest line biggest, each line whole, in its own language), What X wants (filled in as
 * the call captures it), What happens next, and End call. Afterwards: what happened (the person's correction first, the assistant's own words beside it) with Correct it, what it understood, the note for next time and the transcript.
 * Below both: Where X is now, the customer's steps their timeline shows. The transcript is the Owner's and Admin's (the API gives Sales none, and the screen says so). Listen, Whisper, Take over and Transfer are not drawn: the API
 * has none of them yet.
 */
export function CallView({ call, base, w, when, language, stages, end, correct, canRead, english = (_has, lines) => lines }: CallViewProps) {
  const name = call.who || w["ph.dir.inbound"];
  // a sentence about the caller uses their name only when there is one; "Caller ending 998" and "New enquiry" are shown as they are but never inside "What {name} wants"
  const named = callerNamed(call.who);
  const say = (key: string) => (named ? (w[key] ?? "").replace("{name}", name) : (w[`${key}.caller`] ?? w[key] ?? "").replace("{name}", name));
  // who is speaking on a line of the caller's: their name, the API's "Caller ending 998", else just "Caller"
  const speaker = named || /^caller ending\b/i.test(call.who) ? name : w["ph.caller"];
  const facts = { ...call.captured, ...(call.correction?.captured ?? {}) };
  const factRows = Object.entries(facts);
  const lines = call.transcript;
  const hasEnglish = !!lines?.some((l) => l.textEn);
  // the English line under a line that is not in English (owner, 7 Nov 2026); hidden while "Show English" is off
  const englishLine = (l: { textEn: string | null }, big: boolean) =>
    l.textEn ? (
      <span lang="en" data-en className={`mt-1 block [overflow-wrap:break-word] [[data-show-en=off]_&]:hidden ${big ? "text-base text-ink" : "text-sm text-muted"}`}>
        {l.textEn}
      </span>
    ) : null;
  const wants = (
    <section aria-labelledby="call-wants" className="flex flex-col gap-2" data-part="call-wants">
      <h2 id="call-wants" className="m-0 font-display text-lg font-bold">
        {say("ph.wants")}
      </h2>
      {factRows.length ? (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {factRows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{capturedLabel(k)}</dt>
              <dd className="m-0 font-semibold text-ink [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-sm text-muted">{w["ph.wants.none"]}</p>
      )}
    </section>
  );
  const captions = (
    <section aria-labelledby="call-captions" className="flex min-w-0 flex-col gap-3" data-part="call-captions">
      <h2 id="call-captions" className="m-0 text-sm font-bold text-muted">
        {w["ph.captions"]}
      </h2>
      {lines === null && !canRead ? (
        <p className="m-0 text-sm text-muted">{w["ph.captions.hidden"]}</p>
      ) : lines === null || lines.length === 0 ? (
        <p className="m-0 text-sm text-muted">{w["ph.captions.none"]}</p>
      ) : (
        english(hasEnglish,
        <ol aria-live="polite" className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.slice(-6).map((l, i, all) => {
            const newest = i === all.length - 1;
            return (
              <li key={`${l.t}-${i}`} data-who={l.who} className={l.who === "caller" ? "text-right" : ""}>
                <span className="block text-xs font-bold text-muted">{l.who === "assistant" ? w["ph.ai"] : speaker}</span>
                {/* a whole line, never cut inside a word: Telugu letters stay joined */}
                <span lang={l.who === "caller" && call.language ? call.language : undefined} className={`block [overflow-wrap:break-word] ${newest ? "font-display text-xl font-semibold text-ink md:text-2xl" : "text-base text-muted"}`}>
                  {l.text}
                </span>
                {englishLine(l, newest)}
              </li>
            );
          })}
        </ol>)
      )}
    </section>
  );
  const transcript =
    !call.live && lines && lines.length ? (
      <details className={card} data-part="call-transcript">
        <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">{w["ph.transcript.show"]}</summary>
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-sm">
          {lines.map((l, i) => (
            <li key={`${l.t}-${i}`} data-who={l.who}>
              <span className="font-bold text-muted">{l.who === "assistant" ? w["ph.ai"] : speaker}: </span>
              <span lang={l.who === "caller" && call.language ? call.language : undefined}>{l.text}</span>
              {englishLine(l, false)}
            </li>
          ))}
        </ol>
      </details>
    ) : null;
  const result = callResult(call, w);
  return (
    <div data-screen="call" data-live={call.live ? "1" : "0"} className="flex flex-col gap-5">
      <Link href={`${base}/calls`} className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-brand-text">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {w["ph.back"]}
      </Link>
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{name}</h1>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${call.live ? "bg-brand-bg text-brand-text" : "bg-surface-2 text-muted"}`} data-part="call-state">
              {call.live ? "● " : ""}
              {w[`ph.state.${call.state}`]}
            </span>
            {call.sandbox || call.simulated ? <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-muted">{w["ph.test"]}</span> : null}
          </div>
          <p className="m-0 text-sm text-muted">
            {[w[`ph.dir.${call.direction}`], language].filter(Boolean).join(" · ")} · <time dateTime={call.createdAt}>{when(call.createdAt)}</time>
            {!call.live && call.elapsedS > 0 ? ` · ${callClock(call.elapsedS)}` : ""}
          </p>
        </div>
        {/* the customer's page and End call share one row on a phone (the captions then start higher); on a wide screen they stand at the right */}
        <div className="flex flex-wrap items-center justify-between gap-3 md:flex-col-reverse md:items-end">
          {call.leadId ? (
            <Link href={`${base}/customers/${call.leadId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-4" data-part="call-customer">
              {w["ph.customer"]}
            </Link>
          ) : null}
          {end ? <div className="flex flex-wrap items-start gap-3 md:flex-col md:items-end">{end}</div> : null}
        </div>
      </header>
      {call.live ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
          <div className="flex items-center gap-3 rounded-[22px] border border-line bg-surface p-3 lg:flex-col lg:justify-center lg:gap-4 lg:p-5 lg:py-8" data-part="call-orb">
            <div className="size-14 shrink-0 overflow-hidden rounded-full lg:size-40">
              <AssistantOrb state="listen" />
            </div>
            <div className="flex flex-col lg:items-center">
              <span className="font-display text-2xl font-bold tabular-nums lg:text-5xl">{callClock(call.elapsedS)}</span>
              {language ? <span className="text-sm text-muted">{language}</span> : null}
            </div>
          </div>
          <div className={card}>{captions}</div>
          <div className={`${card} flex flex-col gap-4`}>
            {wants}
            <div className="border-t border-line pt-4">
              <h2 className="m-0 font-display text-lg font-bold">{w["ph.next"]}</h2>
              <p className="m-0 mt-1 text-sm text-muted">{w["ph.next.live"]}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="call-summary" className={`${card} flex flex-col gap-3`} data-part="call-summary">
              <h2 id="call-summary" className="m-0 font-display text-lg font-bold">
                {w["ph.summary"]}
              </h2>
              {result ? <p className="m-0 text-sm font-bold text-ink">{result}</p> : null}
              {call.correction?.summary ? (
                <>
                  <p className="m-0 text-base text-ink [overflow-wrap:anywhere]">{call.correction.summary}</p>
                  <p className="m-0 text-xs font-bold text-brand-text">{w["ph.yours"]}</p>
                  {call.summary ? (
                    <p className="m-0 text-sm text-muted [overflow-wrap:anywhere]">
                      <span className="font-semibold">{w["ph.ai.wrote"]}: </span>
                      {call.summary}
                    </p>
                  ) : null}
                </>
              ) : call.summary || call.summaryShort ? (
                <p className="m-0 text-base text-ink [overflow-wrap:anywhere]">{call.summary ?? call.summaryShort}</p>
              ) : (
                <p className="m-0 text-sm text-muted">{w["ph.summary.none"]}</p>
              )}
              {call.correction?.note ? (
                <p className="m-0 rounded-xl bg-surface-2 p-3 text-sm">
                  <span className="block text-xs font-bold text-muted">{w["ph.note"]}</span>
                  <span className="[overflow-wrap:anywhere]">{call.correction.note}</span>
                </p>
              ) : null}
              {correct}
            </section>
            {transcript}
          </div>
          <div className={card}>{wants}</div>
        </div>
      )}
      {stages ? (
        <section aria-labelledby="call-where" className={`${card} flex flex-col gap-3 md:flex-row md:items-center md:gap-6`} data-part="call-where">
          <h2 id="call-where" className="m-0 shrink-0 text-sm font-extrabold">
            {say("ph.where")}
          </h2>
          <ol className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
            {STAGES.map((s) => (
              <li key={s} data-stage={s} data-done={stages.has(s) ? "1" : "0"} className={`flex items-center gap-2 text-sm font-semibold ${stages.has(s) ? "text-ink" : "text-muted"}`}>
                <span aria-hidden="true" className={`size-4 rounded-full ${stages.has(s) ? "bg-[#ff773c] shadow-[0_0_0_4px_var(--v2-brand-bg)]" : "border-2 border-edge"}`} />
                {w[`ph.stage.${s}`]}
                {stages.has(s) ? <span className="sr-only"> {w["ph.stage.done"]}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
