"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { rupeesInWords, rupeesToPaise, formatRupees } from "@/lib/money";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";

export type EntryKind = "payment" | "charge" | "adjustment" | "concession";
export type EntryFormInput = { entryId: string; kind: EntryKind; amount: string; entryDate: string; dueDate: string; invoiceNo: string; reference: string; method: string; reasonCode: string; direction: "debit" | "credit"; mode?: "amount" | "percent" };
type Refused = { ok: false; error: string; mfa?: boolean };
export type RecordAction = (input: EntryFormInput) => Promise<{ ok: true; receiptNo: string | null; entryId: string; replayed: boolean } | Refused>;

const METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
const ADJUST_REASONS = ["correction", "late_fee", "waiver", "rounding", "other"] as const;
const CONCESSION_REASONS = ["scholarship", "sibling", "staff_ward", "hardship", "merit", "other"] as const;

/**
 * Write down money (jobs CO, CS): a payment received, a charge (an invoice or a fee), an adjustment (a late fee or a waiver) or a concession. Each is a confirmation sheet that shows the amount in words as the person types, and
 * says what the entry does. A payment gets a receipt number at once. An adjustment or a concession changes what is owed without money coming in, so it is the Owner's or an Admin's, with the authenticator code (the API decides;
 * the sheet says so in advance). An entry is never edited: a mistake is voided. `prefix` chooses the words of the business type ("due" or "fee"). The id is made when the sheet opens, so a second press is a retry.
 */
export function EntrySheet({ kinds, prefix, words, record, today, receiptBase, secondFactorMissing, role }: { kinds: readonly EntryKind[]; prefix: "due" | "fee"; words: TodayWords; record: RecordAction; today: string; receiptBase: string; secondFactorMissing: boolean; role: "owner" | "admin" | "sales" | "viewer" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<EntryKind | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [done, setDone] = React.useState<null | { kind: EntryKind; receiptNo: string | null; entryId: string }>(null);
  const fresh = (kind: EntryKind): EntryFormInput => ({ entryId: crypto.randomUUID(), kind, amount: "", entryDate: today, dueDate: today, invoiceNo: "", reference: "", method: "cash", reasonCode: kind === "concession" ? "scholarship" : kind === "adjustment" ? (prefix === "fee" ? "correction" : "late_fee") : "", direction: "debit", mode: "amount" });
  const [f, setF] = React.useState<EntryFormInput>(fresh("payment"));
  const set = <K extends keyof EntryFormInput>(k: K, v: EntryFormInput[K]) => setF((c) => ({ ...c, [k]: v }));
  const approverOnly = (k: EntryKind) => k === "adjustment" || k === "concession";
  const can = (k: EntryKind) => role !== "viewer" && (!approverOnly(k) || role === "owner" || role === "admin");
  const percent = f.kind === "concession" && f.mode === "percent";
  const paise = percent ? null : rupeesToPaise(f.amount);
  const percentValue = percent && /^\d{1,3}$/.test(f.amount.trim()) ? Number(f.amount.trim()) : null;
  const close = () => { if (!busy) { setOpen(null); setProblem(null); } };
  const start = (k: EntryKind) => { setF(fresh(k)); setProblem(null); setDone(null); setOpen(k); };

  async function save() {
    if (busy || !open) return;
    setProblem(null);
    if (open === "concession" && percent) {
      if (percentValue === null || percentValue < 1 || percentValue > 100) return setProblem({ text: say(words, "fee.err.percent") });
    } else if (paise === null || paise < 100) return setProblem({ text: say(words, "due.err.amount") });
    if (open === "charge" && f.dueDate < f.entryDate) return setProblem({ text: say(words, "due.err.duedate") });
    setBusy(true);
    const out = await record(f);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setDone({ kind: open, receiptNo: out.receiptNo, entryId: out.entryId });
    setOpen(null);
    router.refresh();
  }

  return (
    <div data-part="entry-actions" className="flex flex-col gap-3">
      {done ? (
        <div role="status" className={`${okLine} flex flex-col gap-1`}>
          <p>{say(words, `due.done.${done.kind}`)}</p>
          {done.receiptNo ? <Link href={`${receiptBase}/${done.entryId}`} className="font-semibold underline">{say(words, "due.receipt", { no: done.receiptNo })}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {kinds.map((k, i) => (can(k) ? (
          <button key={k} type="button" className={i === 0 ? primary : secondary} onClick={() => start(k)}>{say(words, `due.add.${k}`)}</button>
        ) : null))}
      </div>
      {secondFactorMissing && kinds.some((k) => approverOnly(k) && can(k)) ? (
        <p className={help}>{say(words, "due.2fa")} <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link></p>
      ) : null}
      {kinds.map((k) => (
        <Sheet key={k} open={open === k} onClose={close} busy={busy} id={`entry-${k}`} title={say(words, `due.s.${k}.title`)} closeLabel={say(words, "today.act.cancel")}>
          <p className="text-base">{say(words, `due.s.${k}.body`)}</p>
          {k === "adjustment" ? (
            <div role="radiogroup" aria-label={say(words, "due.s.direction")} className="flex flex-col gap-1">
              {(["debit", "credit"] as const).map((d) => (
                <label key={d} className="flex min-h-11 items-center gap-3 text-base">
                  <input type="radio" name="dir" className="size-5 shrink-0 accent-brand-text" checked={f.direction === d} disabled={busy} onChange={() => set("direction", d)} />
                  {say(words, `due.s.direction.${d}`)}
                </label>
              ))}
            </div>
          ) : null}
          {k === "concession" && prefix === "fee" ? (
            <div role="radiogroup" aria-label={say(words, "fee.s.mode")} className="flex flex-col gap-1">
              {(["amount", "percent"] as const).map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-3 text-base">
                  <input type="radio" name="mode" className="size-5 shrink-0 accent-brand-text" checked={(f.mode ?? "amount") === m} disabled={busy} onChange={() => set("mode", m)} />
                  {say(words, `fee.s.mode.${m}`)}
                </label>
              ))}
            </div>
          ) : null}
          <div>
            <label htmlFor={`amt-${k}`} className={label}>{k === "concession" && percent ? say(words, "fee.s.percent") : `${say(words, "due.s.amount")} (₹)`}</label>
            <input id={`amt-${k}`} data-autofocus inputMode="decimal" autoComplete="off" value={f.amount} disabled={busy} aria-describedby={`amt-${k}-words`} onChange={(e) => set("amount", e.target.value)} className={`${field} max-w-60`} />
            <p id={`amt-${k}-words`} className="mt-1.5 min-h-5 text-sm font-semibold" data-part="in-words" aria-live="polite">{paise !== null && paise > 0 ? `${rupeesInWords(paise)} (${formatRupees(paise)})` : ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor={`date-${k}`} className={label}>{say(words, k === "payment" ? "due.s.received" : "due.s.date")}</label>
              <input id={`date-${k}`} type="date" value={f.entryDate} max={k === "payment" ? today : undefined} disabled={busy} onChange={(e) => set("entryDate", e.target.value)} className={field} />
            </div>
            {k === "charge" || (k === "adjustment" && f.direction === "debit") ? (
              <div>
                <label htmlFor={`due-${k}`} className={label}>{say(words, "due.s.dueon")}</label>
                <input id={`due-${k}`} type="date" value={f.dueDate} disabled={busy} onChange={(e) => set("dueDate", e.target.value)} className={field} />
              </div>
            ) : null}
            {k === "payment" ? (
              <div>
                <label htmlFor={`method-${k}`} className={label}>{say(words, "due.s.method")}</label>
                <select id={`method-${k}`} value={f.method} disabled={busy} onChange={(e) => set("method", e.target.value)} className={field}>
                  {METHODS.map((m) => (<option key={m} value={m}>{say(words, `due.method.${m}`)}</option>))}
                </select>
              </div>
            ) : null}
            {k === "adjustment" || k === "concession" ? (
              <div>
                <label htmlFor={`reason-${k}`} className={label}>{say(words, "due.s.reason")}</label>
                <select id={`reason-${k}`} value={f.reasonCode} disabled={busy} onChange={(e) => set("reasonCode", e.target.value)} className={field}>
                  {(k === "concession" ? CONCESSION_REASONS : prefix === "fee" ? ADJUST_REASONS.filter((r) => r !== "late_fee") : ADJUST_REASONS).map((r) => (<option key={r} value={r}>{say(words, `due.reason.${r}`)}</option>))}
                </select>
              </div>
            ) : null}
            {k === "charge" ? (
              <div>
                <label htmlFor={`inv-${k}`} className={label}>{say(words, `${prefix}.s.invoice`)}</label>
                <input id={`inv-${k}`} value={f.invoiceNo} maxLength={40} disabled={busy} onChange={(e) => set("invoiceNo", e.target.value)} className={field} />
              </div>
            ) : null}
            {k === "charge" && prefix === "fee" ? (
              <div>
                <label htmlFor={`ref-${k}`} className={label}>{say(words, "fee.s.head")}</label>
                <input id={`ref-${k}`} value={f.reference} maxLength={40} disabled={busy} onChange={(e) => set("reference", e.target.value)} className={field} />
              </div>
            ) : null}
          </div>
          <p className={help}>{say(words, `due.s.${k}.note`)}</p>
          {problem && open === k ? (
            <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
              <p>{problem.text}</p>
              {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={busy} onClick={() => void save()}>{busy ? say(words, "today.act.working") : say(words, `due.s.${k}.go`)}</button>
            <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
          </div>
        </Sheet>
      ))}
    </div>
  );
}
