"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary } from "../visits/styles";
import { cardBox } from "../Card";

type Refused = { ok: false; error: string; mfa?: boolean };
export type AddConsentedAction = (dueDay: string, q: string) => Promise<{ ok: true; added: number; skipped: { row: number; reason: string }[]; recipients: number } | Refused>;

/**
 * Who gets an offer (campaigns S4): everyone who said YES to offers, has not said STOP, has a number and is not erased. The occasion's day is the day the message goes (the steps count from it); a name filter narrows the list. A
 * customer who did not say yes is never added here; one added by hand without a yes is skipped at send time and counted as left out on the approval screen.
 */
export function OfferAudience({ words, base, canEdit, today, action }: { words: TodayWords; base: string; canEdit: boolean; today: string; action: AddConsentedAction }) {
  const router = useRouter();
  const [day, setDay] = React.useState(today);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState<{ added: number; skipped: number; recipients: number } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  if (!canEdit) return null;
  async function go() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const r = await action(day, q.trim()).catch((): Refused => ({ ok: false, error: say(words, "today.err.generic") }));
    setBusy(false);
    if (!r.ok) return setProblem(r.error);
    setOut({ added: r.added, skipped: r.skipped.length, recipients: r.recipients });
    router.refresh();
  }
  return (
    <section aria-labelledby="oa-h" data-part="offer-audience" className={`${cardBox} flex flex-col gap-3`}>
      <h2 id="oa-h" className="font-display text-xl font-bold">{say(words, "of.aud.title")}</h2>
      <p className={help}>{say(words, "of.aud.help")}</p>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="oa-day" className={label}>{say(words, "of.aud.day")}</label>
          <input id="oa-day" type="date" value={day} min={today} disabled={busy} onChange={(e) => setDay(e.target.value)} className={field} />
          <p className={help}>{say(words, "of.aud.day.help")}</p>
        </div>
        <div>
          <label htmlFor="oa-q" className={label}>{say(words, "of.aud.q")}</label>
          <input id="oa-q" value={q} maxLength={60} disabled={busy} onChange={(e) => setQ(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy || day === ""} onClick={() => void go()}>{busy ? say(words, "today.act.working") : say(words, "of.aud.go")}</button>
        <Link href={`${base}/marketing-consent`} className="text-sm font-semibold underline">{say(words, "of.aud.who")}</Link>
      </div>
      {out ? <p role="status" className={okLine}>{say(words, "of.aud.done", { added: out.added, total: out.recipients })}{out.skipped > 0 ? ` ${say(words, "of.aud.skipped", { n: out.skipped })}` : ""}</p> : null}
      {problem ? <p role="alert" className={errorLine}>{problem}</p> : null}
    </section>
  );
}
