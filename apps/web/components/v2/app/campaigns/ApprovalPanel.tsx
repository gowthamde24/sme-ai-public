"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { PreviewOut } from "@contracts";

import { formatRupees, rupeesInWords } from "@/lib/money";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, help, okLine, primary, quiet } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean; changed?: boolean };
export type ApproveAction = (samplesSha256: string) => Promise<{ ok: true; planned: number; past: number; sendingOn: boolean } | Refused>;

/**
 * Check and approve a campaign (job CQ). Before the Owner approves they SEE the messages: the first person's, the longest, the one with the highest amount and three at random, each as the person will read it, with the
 * total, the dates and the AI disclosure line. Approving covers the whole campaign once and needs the authenticator code; it carries the hash of what was shown, so if anything changed since (a word, a step, a person)
 * the approval is refused and the samples are read again. Approving sends nothing by itself: the steps are planned and each message still passes the outbox's own rules (consent, STOP, quiet hours, daily limit).
 * Anyone else sees the same samples and what is missing, and is told it is the Owner's to approve.
 */
export function ApprovalPanel({ preview, role, status, words, approve }: { preview: PreviewOut; role: "owner" | "admin" | "sales" | "viewer"; status: string; words: TodayWords; approve: ApproveAction }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean; changed?: boolean } | null>(null);
  const [done, setDone] = React.useState<null | { planned: number; past: number; sendingOn: boolean }>(null);
  const issues = preview.issues;
  const owner = role === "owner";
  const ready = issues.length === 0 && status === "draft" && preview.recipients > 0;
  const money = preview.total_amount_paise > 0;

  async function go() {
    if (busy || !checked) return;
    setBusy(true);
    setProblem(null);
    const out = await approve(preview.samples_sha256);
    setBusy(false);
    if (!out.ok) {
      setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}), ...(out.changed ? { changed: true } : {}) });
      if (out.changed) router.refresh();
      return;
    }
    setDone({ planned: out.planned, past: out.past, sendingOn: out.sendingOn });
    setOpen(false);
    router.refresh();
  }

  return (
    <div data-part="approval" className="flex flex-col gap-5">
      {done ? (
        <div role="status" className={`${okLine} flex flex-col gap-1`}>
          <p>{say(words, "camp.ap.done", { planned: done.planned })}</p>
          {done.past > 0 ? <p>{say(words, "camp.ap.past", { n: done.past })}</p> : null}
          {!done.sendingOn ? <p>{say(words, "camp.ap.switchoff")}</p> : null}
        </div>
      ) : null}
      {issues.length > 0 ? (
        <section aria-labelledby="ap-issues" className="rounded-2xl border border-amber-text bg-amber-bg p-4" data-part="issues">
          <h2 id="ap-issues" className="font-display text-lg font-bold text-amber-text">{say(words, "camp.ap.issues")}</h2>
          <ul className="mt-1 list-inside list-disc text-base text-amber-text">
            {issues.map((i) => (<li key={i}>{preview.issue_text[i] ?? say(words, "camp.ap.issue.other")}</li>))}
          </ul>
        </section>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-line p-4 md:grid-cols-4" data-part="totals">
        <div><dt className="text-sm text-muted">{say(words, "camp.ap.people")}</dt><dd className="font-display text-2xl font-bold tabular-nums">{preview.recipients}</dd></div>
        {money ? <div><dt className="text-sm text-muted">{say(words, "camp.ap.total")}</dt><dd className="font-display text-2xl font-bold tabular-nums">{formatRupees(preview.total_amount_paise)}</dd></div> : null}
        {preview.first_due ? <div><dt className="text-sm text-muted">{say(words, "camp.ap.dates")}</dt><dd className="text-base font-semibold">{preview.first_due === preview.last_due ? preview.first_due : `${preview.first_due} – ${preview.last_due}`}</dd></div> : null}
        <div><dt className="text-sm text-muted">{say(words, "camp.ap.steps")}</dt><dd className="text-base font-semibold">{preview.campaign.steps.length}</dd></div>
      </dl>
      <section aria-labelledby="ap-samples" className="flex flex-col gap-3">
        <h2 id="ap-samples" className="font-display text-xl font-bold">{say(words, "camp.ap.samples")}</h2>
        <p className={help}>{say(words, "camp.ap.samples.help")}</p>
        {preview.samples.length === 0 ? (
          <p className="text-base text-muted">{say(words, "camp.ap.nosamples")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {preview.samples.map((s) => (
              <li key={s.recipient_id} data-sample={s.recipient_id} className="flex flex-col gap-2">
                <p className="flex flex-wrap gap-1.5">
                  {s.labels.map((l) => (<Pill key={l} tone="info">{say(words, `camp.sample.${l}`)}</Pill>))}
                  {s.amount_paise !== null ? <Pill tone="neutral">{formatRupees(s.amount_paise)}</Pill> : null}
                </p>
                <div className="max-w-md self-start whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-green-bg p-3 text-base text-ink shadow-sm [overflow-wrap:anywhere]" data-part="bubble">{s.body}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted" data-part="disclosure">{say(words, "camp.ap.disclosure")} <q>{preview.disclosure}</q></p>
      </section>
      {!preview.sending_on ? <p role="note" className="rounded-lg border border-line bg-surface-2 p-3 text-sm">{say(words, "camp.ap.switchoff.now")}</p> : null}
      {status === "draft" ? (
        owner ? (
          <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
              <button type="button" className={primary} disabled={!ready} onClick={() => { setChecked(false); setProblem(null); setOpen(true); }}>{say(words, "camp.ap.approve")}</button>
              {!ready ? <span className={help}>{say(words, issues.length > 0 ? "camp.ap.notready" : "camp.ap.nopeople")}</span> : null}
            </div>
        ) : (
          <p role="note" className="text-base text-muted">{say(words, "camp.ap.ownerOnly")}</p>
        )
      ) : (
        <p role="note" className="text-base text-muted">{say(words, "camp.ap.already", { status: say(words, `camp.status.${status}`) })}</p>
      )}
      <Sheet open={open} onClose={() => !busy && setOpen(false)} busy={busy} id="approve-campaign" title={say(words, "camp.s.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "camp.s.body", { n: preview.recipients })}</p>
        {money ? (
          <>
            <p className="font-display text-2xl font-bold tabular-nums">{formatRupees(preview.total_amount_paise)}</p>
            <p className="font-semibold" data-part="in-words">{rupeesInWords(preview.total_amount_paise)}</p>
          </>
        ) : null}
        <ul className="flex max-h-48 flex-col gap-2 overflow-auto" aria-label={say(words, "camp.ap.samples")}>
          {preview.samples.map((s) => (<li key={s.recipient_id} className="rounded-lg bg-green-bg p-2 text-sm [overflow-wrap:anywhere]">{s.body}</li>))}
        </ul>
        <p className={help}>{say(words, "camp.s.note")}</p>
        <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
          <input type="checkbox" data-autofocus className="size-6 shrink-0 accent-brand-text" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
          {say(words, "camp.s.checked", { n: preview.samples.length })}
        </label>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy || !checked} onClick={() => void go()}>{busy ? say(words, "today.act.working") : say(words, "camp.s.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setOpen(false)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
