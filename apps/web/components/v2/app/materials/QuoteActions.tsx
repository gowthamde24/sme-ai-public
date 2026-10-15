"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { OrderCreatedOut } from "@contracts";

import { formatRupees, rupeesInWords } from "@/lib/money";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean; owner?: boolean };
export type QuoteStepActions = {
  approve: () => Promise<{ ok: true } | Refused>;
  reject: (code: string) => Promise<{ ok: true } | Refused>;
  order: (orderId: string) => Promise<{ ok: true; order: OrderCreatedOut } | Refused>;
  text: (language: string) => Promise<{ ok: true; text: string; reviewed: boolean } | Refused>;
};
export type QuoteFacts = { id: string; quoteNo: number; status: "draft" | "approved" | "rejected" | "superseded"; totalPaise: number; advancePaise: number; trips: number; needsOwner: boolean; customer: string | null; validUntil: string };
const LANGS = ["en", "te", "hi", "kn"] as const;
const REJECTS = ["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"] as const;

function Problem({ p, words }: { p: { text: string; mfa?: boolean } | null; words: TodayWords }) {
  if (!p) return null;
  return (
    <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
      <p>{p.text}</p>
      {p.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
    </div>
  );
}

/**
 * What can be done with a quote (job CO). A draft is approved by the Owner or an Admin after reading the approval sheet: the total, the amount in words, the advance, the trips and the flags; it needs the
 * second factor, and a quote with a flag is the Owner's alone (the API decides; the button only says so in advance). Approving sends nothing to the customer. An approved quote becomes an order, with a
 * warning (never a block) if the customer would go over the credit limit. The WhatsApp message is shown as the customer would read it, in four languages; the owner copies or opens it and sends it themselves.
 */
export function QuoteActions({ quote, role, base, words, actions, secondFactorMissing, go }: { quote: QuoteFacts; role: "owner" | "admin" | "sales" | "viewer"; base: string; words: TodayWords; actions: QuoteStepActions; secondFactorMissing: boolean; go?: (href: string) => void }) {
  const router = useRouter();
  const [sheet, setSheet] = React.useState<null | "approve" | "order" | "reject">(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [rejectCode, setRejectCode] = React.useState<(typeof REJECTS)[number]>("wrong_prices");
  const [done, setDone] = React.useState<null | { kind: "approved" } | { kind: "rejected" } | { kind: "order"; order: OrderCreatedOut }>(null);
  const [orderId] = React.useState(() => crypto.randomUUID());
  const [lang, setLang] = React.useState<(typeof LANGS)[number]>("en");
  const [message, setMessage] = React.useState<{ text: string; reviewed: boolean } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const approver = role === "owner" || role === "admin";
  const writer = role !== "viewer";
  const ownerOnly = quote.needsOwner && role !== "owner";
  const refresh = go ?? (() => router.refresh());

  async function run<T extends { ok: true } | Refused>(work: () => Promise<T>, onOk: (v: Extract<T, { ok: true }>) => void) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const out = await work();
    setBusy(false);
    if (!out.ok) {
      setProblem({ text: (out as Refused).error, ...((out as Refused).mfa ? { mfa: true } : {}) });
      if ((out as Refused).stale) refresh(`${base}/quotes/${quote.id}`);
      return;
    }
    onOk(out as Extract<T, { ok: true }>);
  }
  const close = () => { if (!busy) { setSheet(null); setChecked(false); setProblem(null); } };

  async function loadText(l: (typeof LANGS)[number]) {
    setLang(l);
    setCopied(false);
    const out = await actions.text(l);
    setMessage(out.ok ? { text: out.text, reviewed: out.reviewed } : { text: out.error, reviewed: true });
  }
  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const amountWords = rupeesInWords(quote.totalPaise);
  return (
    <div data-part="quote-actions" className="flex flex-col gap-5">
      {done?.kind === "approved" ? <p role="status" className={okLine}>{say(words, "mat.a.approved")}</p> : null}
      {done?.kind === "rejected" ? <p role="status" className={okLine}>{say(words, "mat.a.rejected")}</p> : null}
      {done?.kind === "order" ? (
        <div role="status" className={`${okLine} flex flex-col gap-1`}>
          <p>{say(words, "mat.a.ordered", { n: done.order.order_no })}</p>
          {done.order.credit?.exceeded ? <p className="text-amber-text">{say(words, "mat.a.credit", { limit: formatRupees(done.order.credit.credit_limit_paise ?? 0), would: formatRupees(done.order.credit.would_be_paise) })}</p> : null}
          <Link href={`${base}/orders/${done.order.order_id}`} className="font-semibold underline">{say(words, "mat.a.openorder")}</Link>
        </div>
      ) : null}

      {quote.status === "draft" && writer && !done ? (
        <div className="flex flex-wrap items-center gap-3">
          {approver ? (
            <button type="button" className={primary} onClick={() => setSheet("approve")} disabled={ownerOnly}>{say(words, "mat.a.approve")}</button>
          ) : null}
          <button type="button" className={secondary} onClick={() => setSheet("reject")}>{say(words, "mat.a.reject")}</button>
          {ownerOnly ? <span className={help}>{say(words, "mat.a.owneronly")}</span> : null}
          {!approver ? <span className={help}>{say(words, "mat.a.waits")}</span> : null}
        </div>
      ) : null}
      {quote.status === "approved" && approver && !done ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primary} onClick={() => setSheet("order")}>{say(words, "mat.a.order")}</button>
          <span className={help}>{say(words, "mat.a.order.help")}</span>
        </div>
      ) : null}
      {secondFactorMissing && approver && (quote.status === "draft" || quote.status === "approved") ? (
        <p role="note" className="text-sm text-muted">{say(words, "mat.a.2fa")} <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link></p>
      ) : null}

      {writer ? (
        <section aria-labelledby="mat-wa" className="flex flex-col gap-3 rounded-2xl border border-line p-4" data-part="whatsapp">
          <h2 id="mat-wa" className="font-display text-xl font-bold">{say(words, "mat.wa.title")}</h2>
          <div role="group" aria-label={say(words, "mat.wa.lang")} className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <button key={l} type="button" aria-pressed={message !== null && lang === l} onClick={() => void loadText(l)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base ${message !== null && lang === l ? "border-brand-edge bg-brand-bg font-semibold text-brand-text" : "border-edge hover:bg-surface-2"}`}>
                {say(words, `today.lang.${l}`)}
              </button>
            ))}
          </div>
          {message ? (
            <>
              {!message.reviewed ? <p role="note" className="text-sm font-medium text-amber-text">{say(words, "mat.wa.draft")}</p> : null}
              <div className="max-w-md self-start whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-green-bg p-3 text-base text-ink shadow-sm [overflow-wrap:anywhere]" data-part="bubble">{message.text}</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondary} onClick={() => void copy()}>{copied ? say(words, "mat.wa.copied") : say(words, "mat.wa.copy")}</button>
              </div>
              <p className={help}>{say(words, quote.status === "approved" ? "mat.wa.note.approved" : "mat.wa.note.draft")}</p>
            </>
          ) : (
            <p className={help}>{say(words, "mat.wa.pick")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`${base}/quotes/${quote.id}/print`} target="_blank" rel="noopener noreferrer" className={secondary}>{say(words, "mat.pdf.open")}</a>
          </div>
        </section>
      ) : null}

      <Sheet open={sheet === "approve"} onClose={close} busy={busy} id="approve" title={say(words, "mat.s.approve.title", { n: quote.quoteNo })} closeLabel={say(words, "today.act.cancel")}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base [&>dt]:text-sm [&>dt]:font-semibold [&>dt]:text-muted">
          {quote.customer ? (<><dt>{say(words, "mat.s.customer")}</dt><dd className="[overflow-wrap:anywhere]">{quote.customer}</dd></>) : null}
          <dt>{say(words, "mat.q.total")}</dt><dd className="font-display text-2xl font-bold">{formatRupees(quote.totalPaise)}</dd>
          <dt>{say(words, "mat.s.inwords")}</dt><dd data-part="in-words" className="font-semibold">{amountWords}</dd>
          <dt>{say(words, "mat.q.advance")}</dt><dd>{formatRupees(quote.advancePaise)}</dd>
          <dt>{say(words, "mat.s.trips")}</dt><dd>{quote.trips}</dd>
          <dt>{say(words, "mat.q.valid")}</dt><dd>{quote.validUntil}</dd>
        </dl>
        {quote.needsOwner ? <p role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text">{say(words, "mat.s.flagged")}</p> : null}
        <p className={help}>{say(words, "mat.s.approve.note")}</p>
        <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
          <input type="checkbox" data-autofocus className="size-6 shrink-0 accent-brand-text" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
          {say(words, "mat.s.checked", { words: amountWords })}
        </label>
        <Problem p={problem} words={words} />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy || !checked} onClick={() => void run(actions.approve, () => { setDone({ kind: "approved" }); setSheet(null); refresh(`${base}/quotes/${quote.id}`); })}>
            {busy ? say(words, "today.act.working") : say(words, "mat.s.approve.go")}
          </button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "order"} onClose={close} busy={busy} id="order" title={say(words, "mat.s.order.title", { n: quote.quoteNo })} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "mat.s.order.body", { total: formatRupees(quote.totalPaise), advance: formatRupees(quote.advancePaise) })}</p>
        <p className="font-semibold" data-part="in-words">{amountWords}</p>
        <p className={help}>{say(words, "mat.s.order.note")}</p>
        <Problem p={problem} words={words} />
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void run(() => actions.order(orderId), (v) => { setDone({ kind: "order", order: v.order }); setSheet(null); refresh(`${base}/quotes/${quote.id}`); })}>
            {busy ? say(words, "today.act.working") : say(words, "mat.s.order.go")}
          </button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "reject"} onClose={close} busy={busy} id="reject" title={say(words, "mat.s.reject.title", { n: quote.quoteNo })} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor="rej" className={label}>{say(words, "mat.s.reject.why")}</label>
          <select id="rej" data-autofocus value={rejectCode} disabled={busy} onChange={(e) => setRejectCode(e.target.value as (typeof REJECTS)[number])} className={field}>
            {REJECTS.map((c) => (<option key={c} value={c}>{say(words, `mat.reject.${c}`)}</option>))}
          </select>
        </div>
        <Problem p={problem} words={words} />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => actions.reject(rejectCode), () => { setDone({ kind: "rejected" }); setSheet(null); refresh(`${base}/quotes/${quote.id}`); })}>
            {busy ? say(words, "today.act.working") : say(words, "mat.s.reject.go")}
          </button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
