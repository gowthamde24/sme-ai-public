"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CallItemOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
type OutcomeKind = "paid" | "promised" | "call_later" | "wrong_number" | "stop";
export type CallListActions = {
  connect: (callRequestId: string) => Promise<{ ok: true; replayed: boolean } | Refused>;
  outcome: (itemId: string, o: { outcome: OutcomeKind; promisedOn?: string | null; callAfter?: string | null }) => Promise<{ ok: true } | Refused>;
};

/**
 * The call list (job CQ): the people a money reminder did not reach, who have not paid. Each row says who, how much, since when and which reminder; the number is never shown. "Call" rings the shop's own phone first and
 * the customer's when the shop picks up (the bridge: Owner and Admin, 9 am to 9 pm India time). Then the outcome is written down in one tap: paid, promised a date, call later, wrong number, or stop (the customer asked not to be
 * contacted). Paid, wrong number and stop close the reminders for that person; a promise holds them until the date.
 */
export function CallList({ items, words, canCall, today, actions, tab, base, more }: { items: readonly CallItemOut[]; words: TodayWords; canCall: boolean; today: string; actions: CallListActions; tab: "open" | "done"; base: string; more: string | null }) {
  const router = useRouter();
  const [calling, setCalling] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<{ id: string; text: string; mfa?: boolean } | null>(null);
  const [ask, setAsk] = React.useState<null | { item: CallItemOut; kind: "promised" | "call_later" }>(null);
  const [date, setDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function call(i: CallItemOut) {
    if (calling) return;
    setCalling(i.id);
    setProblem(null);
    setNotice(null);
    const out = await actions.connect(i.call_request_id);
    setCalling(null);
    if (!out.ok) return setProblem({ id: i.id, text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setNotice(say(words, "camp.cl.ringing", { name: i.contact_name }));
  }
  async function write(i: CallItemOut, outcome: OutcomeKind, extra: { promisedOn?: string; callAfter?: string } = {}) {
    if (busy) return false;
    setBusy(true);
    setProblem(null);
    const out = await actions.outcome(i.id, { outcome, ...extra });
    setBusy(false);
    if (!out.ok) {
      setProblem({ id: i.id, text: out.error, ...(out.mfa ? { mfa: true } : {}) });
      return false;
    }
    setNotice(say(words, "camp.cl.saved", { name: i.contact_name }));
    router.refresh();
    return true;
  }
  async function confirmDate() {
    if (!ask || date === "") return;
    const ok = ask.kind === "promised" ? await write(ask.item, "promised", { promisedOn: date }) : await write(ask.item, "call_later", { callAfter: `${date}T10:00:00+05:30` });
    if (ok) setAsk(null);
  }

  return (
    <div data-screen="call-list" className="flex flex-col gap-4">
      <nav aria-label={say(words, "camp.cl.tabs")} className="flex gap-2">
        {(["open", "done"] as const).map((k) => (
          <Link key={k} href={`${base}/call-list${k === "done" ? "?tab=done" : ""}`} aria-current={tab === k ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base font-semibold ${tab === k ? "border-brand-text bg-brand-bg text-brand-text" : "border-edge"}`}>{say(words, `camp.cl.tab.${k}`)}</Link>
        ))}
      </nav>
      {!canCall && tab === "open" ? <p role="note" className={help}>{say(words, "camp.cl.nocall")}</p> : null}
      {notice ? <p role="status" className={okLine}>{notice}</p> : null}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line p-4 text-base text-muted" data-part="empty">{say(words, tab === "open" ? "camp.cl.empty" : "camp.cl.emptydone")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} data-item={i.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold [overflow-wrap:anywhere]">{i.contact_name}</p>
                  <p className="text-sm text-muted">{i.campaign_name} · {say(words, "camp.cl.step", { n: i.step_no })}</p>
                </div>
                {i.amount_paise !== null ? <p className="font-display text-xl font-bold tabular-nums">{formatRupees(i.amount_paise)}</p> : null}
              </div>
              <p className="text-base">
                {say(words, i.due_date < today ? "camp.cl.overdue" : "camp.cl.due", { date: i.due_date })}
                {i.reference ? ` · ${i.reference}` : ""}
                {i.attempts > 0 ? ` · ${say(words, "camp.cl.attempts", { n: i.attempts })}` : ""}
              </p>
              {i.status === "done" ? (
                <p className="flex flex-wrap gap-2">
                  <Pill tone="neutral">{i.outcome ? say(words, `camp.out.${i.outcome}`) : ""}</Pill>
                  {i.promised_on ? <span className="text-sm text-muted">{say(words, "camp.cl.promised", { date: i.promised_on })}</span> : null}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {canCall ? <button type="button" className={primary} disabled={calling !== null || busy} onClick={() => void call(i)}>{calling === i.id ? say(words, "today.act.working") : say(words, "camp.cl.call")}</button> : null}
                  <div role="group" aria-label={say(words, "camp.cl.how")} className="flex flex-wrap gap-2">
                    <button type="button" className={secondary} disabled={busy} onClick={() => void write(i, "paid")}>{say(words, "camp.out.paid")}</button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => { setDate(""); setAsk({ item: i, kind: "promised" }); }}>{say(words, "camp.out.promised")}</button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => { setDate(""); setAsk({ item: i, kind: "call_later" }); }}>{say(words, "camp.out.call_later")}</button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => void write(i, "wrong_number")}>{say(words, "camp.out.wrong_number")}</button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => void write(i, "stop")}>{say(words, "camp.out.stop")}</button>
                  </div>
                </div>
              )}
              {problem?.id === i.id ? (
                <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
                  <p>{problem.text}</p>
                  {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {more ? <p><Link href={more} className={quiet}>{say(words, "mat.products.more")}</Link></p> : null}
      <Sheet open={ask !== null} onClose={() => !busy && setAsk(null)} busy={busy} id="call-date" title={ask ? say(words, ask.kind === "promised" ? "camp.cl.promise.title" : "camp.cl.later.title") : ""} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor="cl-date" className={label}>{say(words, ask?.kind === "promised" ? "camp.cl.promise.date" : "camp.cl.later.date")}</label>
          <input id="cl-date" type="date" data-autofocus min={today} value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} className={field} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy || date === "" || date < today} onClick={() => void confirmDate()}>{busy ? say(words, "today.act.working") : say(words, "camp.cl.save")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
