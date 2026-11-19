"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { FOR_GOOD, reasonLine, type ActionResult, type CallLanguage, type ContactDaysAgo, type Persona, type PracticeCall as Call, type Prospect, type ProspectAction, type ProspectStatus, type QuoteDraftMade, type QuoteDraftView } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { card, danger, muted, pillClass, secondary, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { GoogleMark } from "./SearchCards";
import { PracticeCall } from "./PracticeCall";
import { facts } from "./facts";
import { MarkContacted } from "./LazyMarkContacted";
import { ProspectContact } from "./ProspectContact";
import { QuoteDraft } from "./QuoteDraft";
import { ResearcherCard } from "./LazyResearcherCard";

export type ListActions = {
  act: (ids: string[], action: ProspectAction) => Promise<Reply<ActionResult[]>>;
  /** Only the presenter's demo video passes this (see `demoPracticeCall`). */
  practice?: (prospectId: string, persona: Persona, language: CallLanguage) => Promise<Reply<Call>>;
  /** The draft quote of a qualified call (contract section 7): the preview, and making it (Owner, Admin). */
  quoteDraft: (prospectId: string) => Promise<Reply<QuoteDraftView>>;
  makeQuoteDraft: (prospectId: string) => Promise<Reply<QuoteDraftMade>>;
  /** "Mark as contacted" (owner 19 Nov); absent = the button is not drawn. */
  mark?: (prospectId: string, input: { daysAgo: ContactDaysAgo; note: string }) => Promise<Reply<Prospect>>;
};

const TONE: Record<ProspectStatus, Parameters<typeof pillClass>[0]> = { new: "brand", researching: "info", call_ready: "green", needs_owner: "amber", skipped: "neutral", contacted: "brand", qualified: "green", not_interested: "red" };
const BULK: readonly ProspectAction[] = ["later", "skip", "not_interested", "do_not_call"]; // no "call": a business is never called by the assistant (Lead Finder v1.0, 18 Nov)

/**
 * The Prospects list (job lead-finder part D, contract sections 3 to 5): best fit first, each business with its decision badge, the one-line why, where it came from ("Google Maps" whenever Google's data is shown), a tick box for
 * the bulk buttons (Call, Ask me later, Skip; Not interested and Do not call behind a confirm: they are for good) and the result of each one. A Ready to call business has the practice call (Owner, Admin); a Qualified one links
 * to its lead and has its draft quote (the preview for everyone; "Make the draft quote" for the Owner and Admin). Nothing here dials: the only call is the simulator, and nothing here approves or sends a quote.
 */
export function ProspectList({ items, words, base, canPractice, labelFixture = false, langNames, actions, practiceOpen = null, businesses = true, demoPracticeCall = false, jobs = false }: { /** JOBS (mock 05): each business is a Researcher card. */ jobs?: boolean; /** ONLY the presenter's demo video (components/v2/app/demo-video, a storyboard made before the Lead Finder v1.0 decision of 18 Nov: its story still has a practice call). Everywhere else false: a business is never called by the assistant. */ demoPracticeCall?: boolean;  /** false: an organisations Lead Finder (a school): no stock sentence and no draft quote (nothing is sold to them). */ businesses?: boolean; /** The business whose practice call is open at first (Today's Call, `?practice=1`). */ practiceOpen?: string | null; items: Prospect[]; words: Words; base: string; canPractice: boolean; /** Say "Made-up businesses for the demo" on each made-up row (the page has not said it once on top). */ labelFixture?: boolean; langNames: Record<CallLanguage, string>; actions: ListActions }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<ProspectAction | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [results, setResults] = useState<ActionResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const names = new Map(items.map((p) => [p.id, p.name ?? t("lf.details.unavailable")]));
  const all = items.length > 0 && picked.length === items.length;

  async function act(action: ProspectAction) {
    setResults(null);
    setFailure(null);
    if (picked.length === 0) return setNote(t("lf.act.none"));
    setNote(null);
    if (FOR_GOOD.includes(action) && asking !== action) return setAsking(action);
    setAsking(null);
    setBusy(true);
    let r: Reply<ActionResult[]>;
    try {
      r = await actions.act(picked, action);
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setResults(r.data);
    setPicked(r.data.filter((x) => !x.ok).map((x) => x.id));
    router.refresh();
  }
  // what we have in stock that these businesses would buy, said ONCE above the list (owner, 4 Nov: the stock sentence repeated on every card), most often matched first
  const inStock = businesses ? stockOf(items) : [];
  const toggle = (pid: string, on: boolean) => setPicked((now) => (on ? [...new Set([...now, pid])] : now.filter((x) => x !== pid)));

  return (
    <div className="flex flex-col gap-3" data-prospects="">
      <div className={`${card} !gap-2`} role="group" aria-labelledby={`${id}-bulk`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={`${id}-bulk`} className="text-base font-semibold">
            {t("lf.bulk.label", { n: picked.length })}
          </p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-6 accent-brand-text" checked={all} onChange={(e) => setPicked(e.target.checked ? items.map((p) => p.id) : [])} />
            {t("lf.selectall")}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {BULK.map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => void act(a)} className={`${FOR_GOOD.includes(a) ? danger : secondary} write-ctl`} data-bulk={a}>
              {t(`lf.act.${a}`)}
            </button>
          ))}
        </div>
        {asking ? (
          <div role="alertdialog" aria-labelledby={`${id}-sure`} className="flex flex-col gap-2 rounded-lg border border-red-text bg-red-bg p-3 text-red-text">
            <p id={`${id}-sure`} className="font-medium">
              {t("lf.act.confirm", { n: picked.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void act(asking)} className={`${danger} write-ctl`} data-bulk-yes="">
                {t("lf.act.yes")}
              </button>
              <button type="button" onClick={() => setAsking(null)} className={secondary}>
                {t("lf.act.no")}
              </button>
            </div>
          </div>
        ) : null}
        {note ? (
          <p role="alert" className="text-sm font-medium text-red-text">
            {note}
          </p>
        ) : null}
        <FailureNote failure={failure} words={words} />
        {results ? (
          <div role="status" className="flex flex-col gap-1 text-sm" data-bulk-results="">
            <p className="font-semibold">{t("lf.act.done", { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length })}</p>
            <ul className="flex flex-col gap-0.5">
              {results.map((r) => {
                const name = names.get(r.id) ?? "";
                return <li key={r.id}>{r.ok && r.status ? t("lf.act.now", { name, status: t(`lf.status.${r.status}`) }) : t(`lf.act.err.${r.error ?? "prospect_state"}`, { name })}</li>;
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {inStock.length > 0 ? (
        <p className="text-base" data-part="in-stock">
          {t("lf.instock", { items: inStock.join(", ") })}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3" data-part="prospects">
        {items.map((p) => (
          <li key={p.id} data-prospect={p.id} className={`${card} !gap-2`}>
            <div className="flex items-start gap-1">
              <label className="-ml-2.5 -mt-1 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                <input type="checkbox" className="size-6 accent-brand-text" checked={picked.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span className="sr-only">{t("lf.select", { name: p.name ?? t("lf.details.unavailable") })}</span>
              </label>
              {jobs ? (
                <div className="min-w-0 flex-1">
                  <ResearcherCard prospect={p} words={words} base={base} mark={actions.mark && !p.suppressed && p.status !== "not_interested" ? actions.mark : undefined} badges={<>{p.attribution ? <GoogleMark /> : null}{labelFixture && p.source === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}</>} />
                  {p.status === "qualified" && p.leadId ? (
                    <Link href={`${base}/leads/${p.leadId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
                      {t("lf.lead")}
                    </Link>
                  ) : null}
                </div>
              ) : (
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words font-display text-lg font-bold leading-snug">{p.name ?? t("lf.details.unavailable")}</h3>
                  <span className={pillClass(TONE[p.status])} data-badge={p.status}>
                    {t(`lf.status.${p.status}`)}
                  </span>
                  {p.attribution ? <GoogleMark /> : null}
                  {labelFixture && p.source === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}
                </div>
                {facts(p, t) ? <p className={`${muted} break-words`} data-facts="">{facts(p, t)}</p> : null}
                {reasonLine(p, t) ? <p className="mt-1 break-words text-base font-medium">{reasonLine(p, t)}</p> : null}
                <p className={`${muted} break-words`} data-source="">
                  {p.sourceLabel}
                </p>
                {p.status === "qualified" && p.leadId ? (
                  <Link href={`${base}/leads/${p.leadId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
                    {t("lf.lead")}
                  </Link>
                ) : null}
              </div>
              )}
            </div>
            {jobs ? null : <ProspectContact prospect={p} words={words} base={base} />}
            {!jobs && actions.mark && !p.suppressed && p.status !== "not_interested" ? <MarkContacted prospect={p} words={words} actions={{ mark: actions.mark }} /> : null}
            {demoPracticeCall && p.status === "call_ready" && canPractice ? <PracticeCall open={practiceOpen === p.id} prospect={p} words={words} base={base} langNames={langNames} run={(persona, language) => actions.practice!(p.id, persona, language)} draft={businesses ? { preview: actions.quoteDraft, make: actions.makeQuoteDraft } : undefined} quotes={businesses} /> : null}
            {p.status === "qualified" && p.leadId && businesses ? <QuoteDraft words={words} base={base} canMake={canPractice} actions={{ preview: () => actions.quoteDraft(p.id), make: () => actions.makeQuoteDraft(p.id) }} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The in-stock items the listed businesses match, each once, the most often matched first (then by name). */
export function stockOf(items: readonly Pick<Prospect, "stockMatch">[]): string[] {
  const seen = new Map<string, number>();
  for (const p of items) for (const m of p.stockMatch?.matched ?? []) seen.set(m, (seen.get(m) ?? 0) + 1);
  return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m).slice(0, 8);
}

export { facts } from "./facts";
