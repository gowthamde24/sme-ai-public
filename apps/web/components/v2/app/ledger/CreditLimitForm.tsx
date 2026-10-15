"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatRupees, rupeesInWords, rupeesToPaise } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";

type Result = { ok: true } | { ok: false; error: string; mfa?: boolean };

/** The customer's credit limit (job CO; the Owner's, with the authenticator code). A warning comes before a new order that would go over it; it never blocks. Empty clears the limit. */
export function CreditLimitForm({ current, words, save }: { current: number | null; words: TodayWords; save: (limitPaise: number | null) => Promise<Result> }) {
  const router = useRouter();
  const [text, setText] = React.useState(current === null ? "" : String(current / 100));
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [done, setDone] = React.useState(false);
  const paise = text.trim() === "" ? null : rupeesToPaise(text);
  async function go() {
    setProblem(null);
    setDone(false);
    if (text.trim() !== "" && (paise === null || paise < 100)) return setProblem({ text: say(words, "due.err.amount") });
    setBusy(true);
    const out = await save(paise);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setDone(true);
    router.refresh();
  }
  return (
    <form noValidate data-part="credit-limit" onSubmit={(e) => { e.preventDefault(); void go(); }} className="flex max-w-md flex-col gap-2 rounded-2xl border border-line p-4">
      <label htmlFor="cl" className={label}>{say(words, "due.limit.label")} (₹)</label>
      <input id="cl" inputMode="decimal" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} aria-describedby="cl-h" className={`${field} max-w-60`} />
      <p id="cl-h" className={help}>{paise !== null && paise > 0 ? `${rupeesInWords(paise)} (${formatRupees(paise)})` : say(words, "due.limit.help")}</p>
      {done ? <p role="status" className={okLine}>{say(words, "due.limit.saved")}</p> : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div><button type="submit" disabled={busy} className={current === null ? primary : secondary}>{busy ? say(words, "today.act.working") : say(words, "due.limit.save")}</button></div>
    </form>
  );
}
