import Link from "next/link";

import { TodayHero, type HeroIn, type HeroOut } from "@/components/v2/app/today/hero/TodayHero";
import type { TodayData } from "@/components/v2/app/today/types";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { listDeskLeads } from "@/lib/api/lead-desk";
import type { OutcomeTotals } from "@/lib/outcomes/types";
import { leadsScreens } from "@/lib/screens/flag";

import { sourceWords } from "./customers/[leadId]/customer-logic";

type Role = "owner" | "admin" | "sales" | "viewer";

/**
 * Today's hero, the data (app v4 part 2; only with APP_V4): everything in it is real. Coming in: the three newest leads with a name, each with the word for its source (Lead Desk's own words), when the Lead Desk is on (LEADS_SCREENS);
 * a list that cannot be read is no rows (the hero then says "No leads yet." with one action for the people who may connect a source). Done today: the calls that have an outcome today, the quotes waiting for the OK, today's store
 * visits; a count that cannot be read is left out, never shown as 0. The sentence is built from the same counts.
 */
export async function todayHero({ token, tenantId, lang, data, totals, role }: { token: string; tenantId: string; lang: Lang; data: TodayData; totals: { mode: "ok"; data: OutcomeTotals } | { mode: string }; role: Role }) {
  const w = wordsFor(lang, ["today.v4.", "ld.source."]);
  // a counted phrase: `key` + ".one" or ".other" (both in the string store), the number in Indian format
  const counted = (key: string, n: number) => (w[`${key}.${n === 1 ? "one" : "other"}`] ?? key).replace("{n}", n.toLocaleString("en-IN"));
  const base = `/app/tenants/${tenantId}`;
  let incoming: HeroIn[] = [];
  if (leadsScreens() !== "off") {
    const page = await listDeskLeads(token, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null));
    incoming = (page?.leads ?? [])
      .filter((l) => l.name.trim() !== "")
      .slice(0, 3)
      .map((l) => ({ id: l.id, name: l.name, source: sourceWords(l.source, w) ?? "", href: `${base}/customers/${l.id}` }));
  }
  const called = totals.mode === "ok" && "data" in totals ? totals.data.positive + totals.data.negative + totals.data.unclear + totals.data.notInterested : null;
  const quotes = data.needs ? data.needs.filter((c) => c.type === "item" && c.item.kind === "quote_approval").length : null;
  const visits = data.store && data.store.state === "ready" ? data.store.visits.length : null;
  const results: HeroOut[] = [
    ...(called !== null ? [{ key: "called", text: counted("today.v4.out.called", called), href: `${base}/lead-desk` }] : []),
    ...(quotes !== null ? [{ key: "quotes", text: counted("today.v4.out.quotes", quotes), href: `${base}/quotes` }] : []),
    ...(visits !== null ? [{ key: "visits", text: counted("today.v4.out.visits", visits), href: `${base}/visits` }] : []),
  ];
  const waiting = data.cards.waiting;
  const sentence = [called !== null ? counted("today.v4.say.called", called) : null, waiting === null ? null : waiting > 0 ? counted("today.v4.say.waiting", waiting) : w["today.v4.say.none"]].filter(Boolean).join(" ");
  const connectHref = leadsScreens() !== "off" && (role === "owner" || role === "admin") ? `${base}/lead-sources` : null;
  return (
    <TodayHero
      incoming={incoming}
      results={results}
      sentence={sentence}
      talkHref={`${base}/talk`}
      connectHref={connectHref}
      words={{ label: w["today.v4.label"], coming: w["today.v4.coming"], done: w["today.v4.done"], talk: w["today.v4.talk"], emptyIn: w["today.v4.empty.in"], connect: w["today.v4.connect"] }}
    />
  );
}

/**
 * The morning plan and the evening report (app v4 part 2): before 4 pm in India, "Today's plan" from the real counts (calls and quotes waiting for the OK, today's store visits) with ONE button, Start, which opens the follow-ups
 * (it never places a call or sends a message by itself: the calls still wait for the owner's OK); after 6 pm, "Your team's report", which opens the stand-up. Between the two, nothing. Uses existing data only.
 */
export function planOrReport({ tenantId, lang, data, hour, standup }: { tenantId: string; lang: Lang; data: TodayData; hour: number; standup: boolean }) {
  const w = wordsFor(lang, ["today.v4."]);
  // a counted phrase: `key` + ".one" or ".other" (both in the string store), the number in Indian format
  const counted = (key: string, n: number) => (w[`${key}.${n === 1 ? "one" : "other"}`] ?? key).replace("{n}", n.toLocaleString("en-IN"));
  const base = `/app/tenants/${tenantId}`;
  const card = "flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between md:p-5";
  if (hour < 16) {
    const calls = data.needs ? data.needs.filter((c) => c.type === "call").length : 0;
    const quotes = data.needs ? data.needs.filter((c) => c.type === "item" && c.item.kind === "quote_approval").length : 0;
    const visits = data.store && data.store.state === "ready" ? data.store.visits.length : 0;
    const lines = [calls ? counted("today.v4.plan.calls", calls) : null, quotes ? counted("today.v4.out.quotes", quotes) : null, visits ? counted("today.v4.out.visits", visits) : null].filter((x): x is string => x !== null);
    return (
      <section aria-labelledby="v4-plan" data-part="today-plan" className={card}>
        <div className="min-w-0">
          <h2 id="v4-plan" className="m-0 font-display text-lg font-bold">
            {w["today.v4.plan.title"]}
          </h2>
          {lines.length ? (
            <ul className="m-0 mt-1 list-none p-0 text-sm text-muted">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-1 text-sm text-muted">{w["today.v4.plan.empty"]}</p>
          )}
        </div>
        {lines.length ? (
          <Link href={`${base}/followups`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[#ff773c] px-6 font-extrabold text-[#1e1e24]">
            {w["today.v4.plan.start"]}
          </Link>
        ) : null}
      </section>
    );
  }
  if (hour >= 18 && standup)
    return (
      <section aria-labelledby="v4-report" data-part="today-report" className={card}>
        <div className="min-w-0">
          <h2 id="v4-report" className="m-0 font-display text-lg font-bold">
            {w["today.v4.report.title"]}
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">{w["today.v4.report.body"]}</p>
        </div>
        <Link href={`${base}/ai-team`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-ink px-6 font-extrabold text-bg">
          {w["today.v4.report.open"]}
        </Link>
      </section>
    );
  return null;
}
