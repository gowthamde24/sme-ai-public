"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { LateFeesPreviewOut } from "@contracts/education";

import { formatRupees, rupeesInWords } from "@/lib/money";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { card, errorLine, help, okLine, primary, quiet } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
export type LateFeesAction = () => Promise<{ ok: true; posted: number; totalPaise: number } | Refused>;

/**
 * Late fees (job CS): a RULE the database works out and a PERSON posts. Looking at this changes nothing. The preview says how many instalments are late under their plan's rule and what the late fees would come to; posting (the Owner or an
 * Admin, with the authenticator code, after a sheet that shows the total in words) writes each as a charge against its instalment, and pressing it twice adds nothing twice. Nothing is added to a parent's account by the clock.
 */
export function LateFeesPanel({ preview, canPost, words, post }: { preview: LateFeesPreviewOut; canPost: boolean; words: TodayWords; post: LateFeesAction }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [done, setDone] = React.useState<null | { posted: number; total: number }>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const out = await post();
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setDone({ posted: out.posted, total: out.totalPaise });
    setOpen(false);
    router.refresh();
  }

  return (
    <section className={card} aria-labelledby="lf-h" data-part="late-fees">
      <h2 id="lf-h" className="font-display text-xl font-bold">{say(words, "edu.late.title")}</h2>
      <p className={help}>{say(words, "edu.late.help")}</p>
      {done ? <p role="status" className={okLine}>{say(words, "edu.late.done", { n: done.posted, amount: formatRupees(done.total) })}</p> : null}
      {preview.count === 0 ? (
        <p className="text-base text-muted">{say(words, "edu.late.none")}</p>
      ) : (
        <>
          <p className="text-base"><strong className="tabular-nums">{preview.count}</strong> {say(words, "edu.late.count")} <strong className="tabular-nums" data-part="late-total">{formatRupees(preview.total_paise)}</strong></p>
          {canPost ? <div><button type="button" className={primary} onClick={() => { setProblem(null); setOpen(true); }}>{say(words, "edu.late.post")}</button></div> : <p className={help}>{say(words, "edu.late.owner")}</p>}
        </>
      )}
      <Sheet open={open} onClose={() => !busy && setOpen(false)} busy={busy} id="late-fees" title={say(words, "edu.late.sheet.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "edu.late.sheet.body", { n: preview.count })}</p>
        <p className="font-display text-2xl font-bold tabular-nums">{formatRupees(preview.total_paise)}</p>
        <p className="font-semibold" data-part="in-words">{rupeesInWords(preview.total_paise)}</p>
        <p className={help}>{say(words, "edu.late.sheet.note")}</p>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void go()}>{busy ? say(words, "today.act.working") : say(words, "edu.late.sheet.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setOpen(false)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </section>
  );
}
