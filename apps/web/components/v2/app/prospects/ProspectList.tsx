"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { FOR_GOOD, reasonLine, type ActionResult, type CallLanguage, type Persona, type PracticeCall as Call, type Prospect, type ProspectAction, type ProspectStatus } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { card, danger, muted, pillClass, secondary, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { GoogleMark } from "./SearchCards";
import { PracticeCall } from "./PracticeCall";

export type ListActions = {
  act: (ids: string[], action: ProspectAction) => Promise<Reply<ActionResult[]>>;
  practice: (prospectId: string, persona: Persona, language: CallLanguage) => Promise<Reply<Call>>;
};

const TONE: Record<ProspectStatus, Parameters<typeof pillClass>[0]> = { new: "brand", researching: "info", call_ready: "green", needs_owner: "amber", skipped: "neutral", contacted: "brand", qualified: "green", not_interested: "red" };
const BULK: readonly ProspectAction[] = ["call", "later", "skip", "not_interested", "do_not_call"];

/**
 * The Prospects list (job lead-finder part D, contract sections 3 to 5): best fit first, each business with its decision badge, the one-line why, where it came from ("Google Maps" whenever Google's data is shown), a tick box for
 * the bulk buttons (Call, Ask me later, Skip; Not interested and Do not call behind a confirm: they are for good) and the result of each one. A Ready to call business has the practice call (Owner, Admin); a Qualified one links
 * to its lead. Nothing here dials: the only call is the simulator.
 */
export function ProspectList({ items, words, base, canPractice, labelFixture = false, langNames, actions }: { items: Prospect[]; words: Words; base: string; canPractice: boolean; /** Say "Made-up businesses for the demo" on each made-up row (the page has not said it once on top). */ labelFixture?: boolean; langNames: Record<CallLanguage, string>; actions: ListActions }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<ProspectAction | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [results, setResults] = useState<ActionResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const names = new Map(items.map((p) => [p.id, p.name]));
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

      <ul className="flex flex-col gap-3" data-part="prospects">
        {items.map((p) => (
          <li key={p.id} data-prospect={p.id} className={`${card} !gap-2`}>
            <div className="flex items-start gap-1">
              <label className="-ml-2.5 -mt-1 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                <input type="checkbox" className="size-6 accent-brand-text" checked={picked.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span className="sr-only">{t("lf.select", { name: p.name })}</span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words font-display text-lg font-bold leading-snug">{p.name}</h3>
                  <span className={pillClass(TONE[p.status])} data-badge={p.status}>
                    {t(`lf.status.${p.status}`)}
                  </span>
                  {p.attribution ? <GoogleMark /> : null}
                  {labelFixture && p.source === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}
                </div>
                {p.category || p.area ? <p className={`${muted} break-words`}>{[p.category, p.area].filter(Boolean).join(" · ")}</p> : null}
                {reasonLine(p, t) ? <p className="mt-1 break-words text-base font-medium">{reasonLine(p, t)}</p> : null}
                {p.fitReason ? <p className={`${muted} break-words`}>{p.fitReason}</p> : null}
                <p className={`${muted} break-words`} data-source="">
                  {p.sourceLabel}
                </p>
                {p.status === "qualified" && p.leadId ? (
                  <Link href={`${base}/leads/${p.leadId}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
                    {t("lf.lead")}
                  </Link>
                ) : null}
              </div>
            </div>
            {p.status === "call_ready" && canPractice ? <PracticeCall prospect={p} words={words} base={base} langNames={langNames} run={(persona, language) => actions.practice(p.id, persona, language)} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
