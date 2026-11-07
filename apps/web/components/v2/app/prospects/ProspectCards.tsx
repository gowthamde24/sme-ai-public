"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { chipOf, likeThis, suggested } from "@/lib/lead-finder/radar";
import { FOR_GOOD, reasonLine, type ActionResult, type CallLanguage, type Persona, type PracticeCall as Call, type Prospect, type ProspectAction, type QuoteDraftMade, type QuoteDraftView, type Search } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { pillClass, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { PracticeCall } from "./PracticeCall";
import { facts, stockOf } from "./ProspectList";
import { QuoteDraft } from "./QuoteDraft";
import { GoogleMark, PlanCard, ResultCard } from "./SearchCards";

export type CardActions = {
  act: (ids: string[], action: ProspectAction) => Promise<Reply<ActionResult[]>>;
  practice: (prospectId: string, persona: Persona, language: CallLanguage) => Promise<Reply<Call>>;
  quoteDraft: (prospectId: string) => Promise<Reply<QuoteDraftView>>;
  makeQuoteDraft: (prospectId: string) => Promise<Reply<QuoteDraftMade>>;
  /** "Find more like this shop": the plan card of a search for this shop's type (nothing is searched until the OK). */
  planLikeThis: (prospectId: string) => Promise<Reply<Search>>;
  approve: (searchId: string) => Promise<Reply<Search>>;
  cancel: (searchId: string) => Promise<Reply<Search>>;
};

const chip = "inline-flex min-h-8 items-center whitespace-nowrap rounded-full px-3 text-sm font-bold";
const CHIP: Record<ReturnType<typeof chipOf>, string> = { call_ready: "bg-[#ff773c] text-[#1e1e24]", needs_owner: "border-2 border-ink text-ink", skipped: "bg-surface-2 text-muted", other: "bg-surface-2 text-ink" };
const btnCall = "inline-flex min-h-11 items-center justify-center rounded-full bg-[#ff773c] px-5 font-extrabold text-[#1e1e24] disabled:opacity-60";
const btnNot = "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-edge bg-surface px-4 font-bold text-ink disabled:opacity-60";
const btnLink = "inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-4 disabled:opacity-60";

/**
 * The businesses the Lead Finder found, as app v4's cards (part 5, from app-Finder.png): each with its name, what and where it is, the one-line why, the decision chip (Call now / Ask you first / Skip), and Call and Not now on one line
 * (Call is the owner's yes, Not now asks again tomorrow; Skip, Not interested and Do not call are under More, the last two behind a confirm: they are for good). "Find more like this shop" plans a search for the shop's own type (the plan
 * card shows here; the OK is the search). Under the list, "Call all suggested shops" says yes to every business waiting for the owner's OK, after one confirm. Nothing here dials a number: a call is the practice call in the simulator.
 */
export function ProspectCards({ items, words, base, canPractice, canSearch, labelFixture = false, langNames, actions, practiceOpen = null }: { items: Prospect[]; words: Words; base: string; canPractice: boolean; /** Owner or Admin: may OK a search ("Find more like this shop" shows its OK) */ canSearch: boolean; labelFixture?: boolean; langNames: Record<CallLanguage, string>; actions: CardActions; practiceOpen?: string | null }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<{ ids: string[]; action: ProspectAction } | null>(null);
  const [all, setAll] = useState(false);
  const names = new Map(items.map((p) => [p.id, p.name]));
  const inStock = stockOf(items);
  const waiting = suggested(items);

  async function act(ids: string[], action: ProspectAction) {
    if (FOR_GOOD.includes(action) && !(asking && asking.action === action && asking.ids[0] === ids[0])) return setAsking({ ids, action });
    setAsking(null);
    setAll(false);
    setBusy(ids.join(","));
    setFailure(null);
    let r: Reply<ActionResult[]>;
    try {
      r = await actions.act(ids, action);
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setDone((d) => ({ ...d, ...Object.fromEntries(r.data.map((x) => [x.id, x.ok && x.status ? t("lf.act.now", { name: names.get(x.id) ?? "", status: t(`lf.status.${x.status}`) }) : t(`lf.act.err.${x.error ?? "prospect_state"}`, { name: names.get(x.id) ?? "" })])) }));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3" data-prospects="" data-v4="">
      {inStock.length > 0 ? (
        <p className="m-0 text-sm text-muted" data-part="in-stock">
          {t("lf.instock", { items: inStock.join(", ") })}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-part="prospects">
        {items.map((p) => {
          const c = chipOf(p.status);
          const canDecide = p.status === "needs_owner" || p.status === "skipped" || p.status === "researching" || p.status === "new";
          const working = busy !== null && busy.split(",").includes(p.id);
          const asked = asking?.ids[0] === p.id ? asking : null;
          const line = reasonLine(p, t);
          const factsLine = facts(p, t);
          return (
            <li key={p.id} data-prospect={p.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5">
              <h3 className="m-0 break-words font-display text-lg font-bold leading-snug">{p.name}</h3>
              {factsLine ? <p className="m-0 break-words text-sm text-muted" data-facts="">{factsLine}</p> : null}
              {line ? <p className="m-0 break-words text-sm text-ink">{line}</p> : null}
              <div className="flex flex-wrap items-center gap-2" data-part="decide">
                <span className={`${chip} ${CHIP[c]}`} data-badge={p.status}>
                  {c === "other" ? t(`lf.status.${p.status}`) : t(`lf.v4.chip.${c}`)}
                </span>
                {p.attribution ? <GoogleMark /> : null}
                {labelFixture && p.source === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}
                {canDecide ? (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy !== null} onClick={() => void act([p.id], "call")} className={`${btnCall} write-ctl`} data-act="call">
                      {working ? t("lf.working") : t("lf.v4.call")}
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => void act([p.id], "later")} className={`${btnNot} write-ctl`} data-act="later">
                      {t("lf.v4.notnow")}
                    </button>
                  </span>
                ) : null}
              </div>
              {done[p.id] ? (
                <p role="status" className="m-0 text-sm font-semibold text-brand-text" data-done="">
                  {done[p.id]}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0">
                {p.category ? <LikeThis prospect={p} words={words} base={base} canApprove={canSearch} actions={actions} /> : null}
                {p.status !== "not_interested" && p.status !== "skipped" ? (
                  <details className="group">
                    <summary className={`${btnLink} cursor-pointer list-none`}>{t("lf.v4.more")}</summary>
                    <div className="flex flex-wrap gap-2 pb-2">
                      <button type="button" disabled={busy !== null} onClick={() => void act([p.id], "skip")} className={`${btnNot} write-ctl`}>
                        {t("lf.act.skip")}
                      </button>
                      {FOR_GOOD.map((a) => (
                        <button key={a} type="button" disabled={busy !== null} onClick={() => void act([p.id], a)} className={`${btnNot} write-ctl`} data-for-good={a}>
                          {t(`lf.act.${a}`)}
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
              {asked ? (
                <div role="alertdialog" aria-label={t("lf.act.confirm", { n: 1 })} className="flex flex-col gap-2 rounded-lg border border-red-text bg-red-bg p-3 text-red-text">
                  <p className="m-0 font-medium">{t("lf.act.confirm", { n: 1 })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy !== null} onClick={() => void act(asked.ids, asked.action)} className={`${btnNot} write-ctl`} data-bulk-yes="">
                      {t("lf.act.yes")}
                    </button>
                    <button type="button" onClick={() => setAsking(null)} className={btnNot}>
                      {t("lf.act.no")}
                    </button>
                  </div>
                </div>
              ) : null}
              {p.source === "fixture" || p.sourceLabel ? <p className="m-0 break-words text-xs text-muted" data-source="">{p.sourceLabel}</p> : null}
              {p.status === "qualified" && p.leadId ? (
                <Link href={`${base}/customers/${p.leadId}`} className={btnLink}>
                  {t("lf.lead")}
                </Link>
              ) : null}
              {p.status === "call_ready" && canPractice ? <PracticeCall open={practiceOpen === p.id} prospect={p} words={words} base={base} langNames={langNames} run={(persona, language) => actions.practice(p.id, persona, language)} draft={{ preview: actions.quoteDraft, make: actions.makeQuoteDraft }} /> : null}
              {p.status === "qualified" && p.leadId ? <QuoteDraft words={words} base={base} canMake={canPractice} actions={{ preview: () => actions.quoteDraft(p.id), make: () => actions.makeQuoteDraft(p.id) }} /> : null}
            </li>
          );
        })}
      </ul>
      <FailureNote failure={failure} words={words} />
      {waiting.length > 0 ? (
        <div className="sticky bottom-20 flex flex-col gap-2 lg:bottom-3" data-part="call-all">
          {all ? (
            <div role="alertdialog" aria-labelledby={`${id}-all`} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-[0_10px_30px_-12px_rgba(30,30,36,.4)]">
              <p id={`${id}-all`} className="m-0 font-semibold">
                {t("lf.v4.all.sure", { n: waiting.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy !== null} onClick={() => void act(waiting, "call")} className={`${btnCall} write-ctl`} data-all-yes="">
                  {t("lf.v4.all.yes", { n: waiting.length })}
                </button>
                <button type="button" onClick={() => setAll(false)} className={btnNot}>
                  {t("lf.v4.all.no")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => setAll(true)} className={`${btnCall} min-h-12 w-full text-base write-ctl`} data-all="">
              {t("lf.v4.all", { n: waiting.length })}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** "Find more like this shop": plans a search for this shop's type (the plan card opens under the shop; the OK, for the Owner and an Admin, is the search); after the OK the page is read again. */
function LikeThis({ prospect, words, base, canApprove, actions }: { prospect: Prospect; words: Words; base: string; canApprove: boolean; actions: Pick<CardActions, "planLikeThis" | "approve" | "cancel"> }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  if (!likeThis(prospect, prospect.area)) return null;
  async function run(step: () => Promise<Reply<Search>>, after?: (s: Search) => void) {
    setBusy(true);
    setFailure(null);
    let r: Reply<Search>;
    try {
      r = await step();
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setSearch(r.data);
    after?.(r.data);
  }
  return (
    <div className={search !== null || failure !== null ? "flex w-full flex-col gap-2" : "contents"} data-part="like-this">
      {search === null ? (
        <button type="button" disabled={busy} onClick={() => void run(() => actions.planLikeThis(prospect.id))} className={`${btnLink} self-start write-ctl`} data-like="">
          {busy ? t("lf.working") : t("lf.v4.like")}
        </button>
      ) : null}
      <FailureNote failure={failure} words={words} />
      {search?.state === "planned" ? <PlanCard search={search} words={words} canApprove={canApprove} busy={busy} onOk={() => void run(() => actions.approve(search.id), () => router.refresh())} onCancel={() => (canApprove ? void run(() => actions.cancel(search.id)) : setSearch(null))} /> : null}
      {search && search.state !== "planned" ? <ResultCard search={search} words={words} base={base} /> : null}
    </div>
  );
}
