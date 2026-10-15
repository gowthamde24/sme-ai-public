import type { ResultsOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { card } from "../visits/styles";

const FUNNEL = ["sent", "delivered", "read"] as const;
const OTHER = ["planned", "waiting", "held", "failed", "blocked", "skipped"] as const;
const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * What happened to a campaign (job CQ), worked out from the outbox and the WhatsApp delivery reports, never stored: how many were sent, delivered, read, replied and paid after a reminder (with the amount, from the ledger),
 * what is still waiting, and what was blocked or skipped, with the reason in words (no consent, STOP, quiet hours, the daily limit, paid already ...). Then each day, the people closed and why, and the call list's outcomes.
 */
export function ResultsView({ results, words }: { results: ResultsOut; words: TodayWords }) {
  const s = results.by_state;
  const sentAll = num(s.sent) + num(s.delivered) + num(s.read);
  const deliveredAll = num(s.delivered) + num(s.read);
  const paid = results.paid_after_reminder;
  const reasons = Object.entries(results.by_reason).sort((a, b) => b[1] - a[1]);
  const days = results.by_day as { day: string; states: Record<string, number> }[];
  const calls = results.calls as { open?: number; done?: number; outcomes?: Record<string, number> };
  const cell = (key: string, value: React.ReactNode) => (
    <div key={key} className="rounded-xl border border-line bg-surface p-3">
      <dt className="text-sm text-muted">{say(words, `camp.res.${key}`)}</dt>
      <dd className="font-display text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
  return (
    <div data-part="results" className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cell("people", results.recipients)}
        {cell("sent", sentAll)}
        {cell("delivered", deliveredAll)}
        {cell("read", num(s.read))}
        {cell("replied", results.replied)}
        {cell("paid", `${num(paid.recipients)}${num(paid.amount_paise) > 0 ? ` · ${formatRupees(num(paid.amount_paise))}` : ""}`)}
      </dl>
      <section aria-labelledby="res-other" className={card}>
        <h2 id="res-other" className="font-display text-xl font-bold">{say(words, "camp.res.steps")}</h2>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-base md:grid-cols-3">
          {OTHER.map((k) => (<li key={k} className="flex items-baseline justify-between gap-2"><span>{say(words, `camp.res.state.${k}`)}</span><span className="font-semibold tabular-nums">{num(s[k])}</span></li>))}
        </ul>
        {FUNNEL.every((k) => num(s[k]) === 0) && OTHER.every((k) => num(s[k]) === 0) ? <p className="text-base text-muted">{say(words, "camp.res.none")}</p> : null}
      </section>
      {reasons.length > 0 ? (
        <section aria-labelledby="res-why" className={card}>
          <h2 id="res-why" className="font-display text-xl font-bold">{say(words, "camp.res.why")}</h2>
          <ul className="flex flex-col gap-1 text-base">
            {reasons.map(([code, n]) => (<li key={code} className="flex items-baseline justify-between gap-2"><span>{words[`camp.reason.${code}`] ?? say(words, "camp.reason.other")}</span><span className="font-semibold tabular-nums">{n}</span></li>))}
          </ul>
        </section>
      ) : null}
      {days.length > 0 ? (
        <section aria-labelledby="res-days" className={card}>
          <h2 id="res-days" className="font-display text-xl font-bold">{say(words, "camp.res.days")}</h2>
          <ul className="flex flex-col gap-1 text-base">
            {days.map((d) => (<li key={d.day} className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">{d.day}</span><span className="text-sm text-muted">{Object.entries(d.states).map(([k, n]) => `${say(words, `camp.res.state.${k}`)} ${n}`).join(" · ")}</span></li>))}
          </ul>
        </section>
      ) : null}
      {Object.keys(results.closed).length > 0 || num(calls.open) + num(calls.done) > 0 ? (
        <section aria-labelledby="res-closed" className={card}>
          <h2 id="res-closed" className="font-display text-xl font-bold">{say(words, "camp.res.closed")}</h2>
          <ul className="flex flex-col gap-1 text-base">
            {Object.entries(results.closed).map(([k, n]) => (<li key={k} className="flex items-baseline justify-between gap-2"><span>{words[`camp.closed.${k}`] ?? k}</span><span className="font-semibold tabular-nums">{n}</span></li>))}
          </ul>
          {num(calls.open) + num(calls.done) > 0 ? (
            <p className="text-base">{say(words, "camp.res.calls", { open: num(calls.open), done: num(calls.done) })}{Object.entries(calls.outcomes ?? {}).length > 0 ? ` (${Object.entries(calls.outcomes ?? {}).map(([k, n]) => `${words[`camp.out.${k}`] ?? k} ${n}`).join(", ")})` : ""}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
