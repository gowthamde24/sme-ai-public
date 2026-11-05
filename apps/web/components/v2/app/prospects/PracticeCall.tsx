"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { CALL_LANGUAGES, PERSONAS, rupees, type CallLanguage, type Persona, type PracticeCall as Call, type Prospect, type QuoteDraftMade, type QuoteDraftView } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { h3, label as labelClass, muted, pillClass, primary, selectClass, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { QuoteDraft } from "./QuoteDraft";

const OUTCOME_TONE = { qualified: "green", contacted: "brand", not_interested: "neutral", do_not_call: "red" } as const;

/**
 * The practice call of a Ready to call business (job lead-finder part D, contract section 5; Owner and Admin): our assistant against a made-up shopkeeper (the persona), in English or Telugu, IN THE SIMULATOR. It is labelled
 * "Practice call (simulated): nothing was dialled" before and after. The answer shows the outcome, the three-line summary and what was said (returned once, kept nowhere), and the quote suggestion as a DRAFT for the Owner's OK:
 * its prices are the catalogue's, and a missing price says "you give the price" (never a guess). A call that QUALIFIED then shows its draft quote at once (contract section 7): the preview and "Make the draft quote".
 */
type Draft = { preview: (prospectId: string) => Promise<Reply<QuoteDraftView>>; make: (prospectId: string) => Promise<Reply<QuoteDraftMade>> };
export function PracticeCall({ prospect, words, base, langNames, run, draft, quotes = true }: { /** false: an organisations Lead Finder (a school): the call's quote suggestion is not drawn (nothing is sold to them). */ quotes?: boolean; prospect: Pick<Prospect, "id" | "name">; words: Words; base: string; langNames: Record<CallLanguage, string>; run: (persona: Persona, language: CallLanguage) => Promise<Reply<Call>>; /** The draft quote of a call that qualified (the practice call is the Owner's or an Admin's, who may make it). */ draft?: Draft }) {
  const t = makeT(words);
  const id = useId();
  const [persona, setPersona] = useState<Persona>("interested");
  const [language, setLanguage] = useState<CallLanguage>("en");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [call, setCall] = useState<Call | null>(null);

  async function start() {
    setBusy(true);
    setFailure(null);
    let r: Reply<Call>;
    try {
      r = await run(persona, language);
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setCall(r.data);
  }

  return (
    <details className="rounded-2xl bg-surface-2 px-3 py-1 sm:px-4" data-practice={prospect.id}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("lf.pc.open")}</summary>
      <div className="flex flex-col gap-3 pb-3">
        <p className="text-sm font-semibold text-info-text">{t("lf.pc.title")}</p>
        <p className={muted}>{t("lf.pc.intro")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-persona`} className={labelClass}>
              {t("lf.pc.persona")}
            </label>
            <select id={`${id}-persona`} value={persona} onChange={(e) => setPersona(e.target.value as Persona)} className={selectClass}>
              {PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {t(`lf.persona.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-lang`} className={labelClass}>
              {t("lf.pc.lang")}
            </label>
            <select id={`${id}-lang`} value={language} onChange={(e) => setLanguage(e.target.value as CallLanguage)} className={selectClass}>
              {CALL_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {langNames[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <button type="button" disabled={busy} onClick={() => void start()} className={`${primary} write-ctl`} data-practice-start="">
            {busy ? t("lf.pc.working") : t("lf.pc.start")}
          </button>
        </div>
        <FailureNote failure={failure} words={words} />
        {call ? <CallResult call={call} words={words} base={base} quotes={quotes} /> : null}
        {call && draft && call.outcome === "qualified" && call.prospect.leadId ? <QuoteDraft key={call.callId} words={words} base={base} canMake open actions={{ preview: () => draft.preview(call.prospect.id), make: () => draft.make(call.prospect.id) }} /> : null}
      </div>
    </details>
  );
}

function CallResult({ call, words, base, quotes }: { call: Call; words: Words; base: string; quotes: boolean }) {
  const t = makeT(words);
  return (
    <section role="status" aria-labelledby={`pc-${call.callId}`} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3" data-practice-result="">
      <h4 id={`pc-${call.callId}`} className={h3}>
        {t("lf.pc.title")}
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted">{t("lf.pc.outcome")}</span>
        <span className={pillClass(OUTCOME_TONE[call.outcome])} data-outcome={call.outcome}>
          {t(`lf.outcome.${call.outcome}`)}
        </span>
        {call.whatsappOk ? <span className={pillClass("green")}>{t("lf.pc.whatsapp")}</span> : null}
      </div>
      {call.outcome === "qualified" && call.prospect.leadId ? (
        <Link href={`${base}/leads/${call.prospect.leadId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
          {t("lf.lead")}
        </Link>
      ) : null}
      {call.summary ? (
        <div>
          <p className="text-sm font-semibold text-muted">{t("lf.pc.summary")}</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{call.summary}</p>
        </div>
      ) : null}
      {quotes && call.quoteSuggestion.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-quote-draft="">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted">
            {t("lf.pc.quote")} <span className={pillClass("amber")}>{t("today.state.draft")}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {call.quoteSuggestion.map((q, i) => (
              <li key={`${q.item}-${i}`} className="[overflow-wrap:anywhere]">
                <span className="font-semibold">{q.item}</span>
                {" · "}
                <span className="tabular-nums">{q.pricePaise !== null ? `${rupees(q.pricePaise)}${q.unit ? ` / ${q.unit}` : ""}` : t("lf.pc.price.none")}</span>
                {q.moq !== null ? ` · ${t("lf.pc.moq", { n: q.moq, unit: q.unit })}` : ""}
                {q.quantitySaid ? <span className="text-muted"> · {t("lf.pc.said", { text: q.quantitySaid })}</span> : null}
              </li>
            ))}
          </ul>
          <p className={muted}>{t("lf.pc.quote.note")}</p>
        </div>
      ) : null}
      {call.transcript.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-muted">{t("lf.pc.transcript")}</p>
          <ol className="mt-1 flex flex-col gap-1.5">
            {call.transcript.map((turn, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="font-semibold">{t(`lf.pc.who.${turn.who}`)}:</span> {turn.text}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
