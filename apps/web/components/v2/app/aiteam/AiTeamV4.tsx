import Link from "next/link";

import { dayWords, type Todo } from "@/lib/aiteam/standup-steps";

import { fill } from "./shift";

type W = Readonly<Record<string, string>>;
const w = (words: W, k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);

/** The three parts of the AI team page (app v4 part 7): real links, the current one the dark chip, like the design's pill. Which parts there are depends on the person: the report is the Owner's and Admin's. */
export type V4Tab = "report" | "shift" | "helpers";
export function AiTeamTabs({ words, base, tabs, current, date, today }: { words: W; base: string; tabs: readonly V4Tab[]; current: V4Tab; date: string; today: string }) {
  const href = (t: V4Tab) => `${base}/ai-team?${new URLSearchParams({ tab: t, ...(date !== today ? { date } : {}) }).toString()}`;
  return (
    <nav aria-label={w(words, "aiteam.v4.tabs")} className="flex w-full max-w-full gap-1 rounded-full border border-line bg-surface p-1 shadow-[var(--v2-shadow)] sm:inline-flex sm:w-auto" data-part="v4-tabs">
      {tabs.map((t) => (
        <Link key={t} href={href(t)} aria-current={t === current ? "page" : undefined} className={`inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full px-2 text-center text-sm font-semibold sm:flex-none sm:px-5 sm:text-base ${t === current ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}>
          {t === "report" && date !== today ? w(words, "aiteam.v4.tab.report.day") : w(words, `aiteam.v4.tab.${t}`)}
        </Link>
      ))}
    </nav>
  );
}

/** "To do tomorrow": what waits for the owner, from the same counts as the menu's chips (never invented), each with the one button to where it is done. */
export function TodoTomorrow({ words, todos }: { words: W; todos: readonly Todo[] }) {
  return (
    <section aria-labelledby="v4-todo" className="flex flex-col gap-3" data-part="todo">
      <h2 id="v4-todo" className="m-0 font-display text-xl font-bold">
        {w(words, "aiteam.v4.todo")}
      </h2>
      {todos.length === 0 ? <p className="m-0 rounded-[22px] border border-line bg-surface p-4 text-base text-muted">{w(words, "aiteam.v4.todo.none")}</p> : null}
      {todos.map((t) => (
        <article key={t.key} data-todo={t.key} className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
          <div>
            <h3 className="m-0 font-display text-lg font-bold leading-snug">{w(words, `aiteam.v4.todo.${t.key}.${t.n === 1 ? "one" : "many"}`, { n: t.n.toLocaleString("en-IN") })}</h3>
            <p className="m-0 mt-1 text-sm text-muted">{w(words, `aiteam.v4.todo.${t.key}.b`)}</p>
          </div>
          <Link href={t.href} className="inline-flex min-h-11 items-center self-start rounded-full bg-[#ff773c] px-5 text-base font-semibold text-[#1e1e24] hover:brightness-95">
            {w(words, `aiteam.v4.todo.${t.key}.btn`)}
          </Link>
        </article>
      ))}
    </section>
  );
}

/** "Earlier reports": the days before that really had a stand-up, newest first, each a link to that day's report with how long it is. */
export function EarlierReports({ words, base, locale, items, current }: { words: W; base: string; locale: string; items: readonly { date: string; seconds: number | null }[]; current: string }) {
  return (
    <section aria-labelledby="v4-earlier" className="flex flex-col gap-3" data-part="earlier">
      <h2 id="v4-earlier" className="m-0 font-display text-xl font-bold">
        {w(words, "aiteam.v4.earlier")}
      </h2>
      {items.length === 0 ? (
        <p className="m-0 rounded-[22px] border border-line bg-surface p-4 text-base text-muted">{w(words, "aiteam.v4.earlier.none")}</p>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-[22px] border border-line bg-surface p-0 shadow-[var(--v2-shadow)]">
          {items.map((i) => {
            const day = dayWords(i.date, locale);
            return (
              <li key={i.date} className="border-b border-line last:border-b-0">
                <Link href={`${base}/ai-team?${new URLSearchParams({ tab: "report", date: i.date }).toString()}`} aria-current={i.date === current ? "page" : undefined} aria-label={w(words, "aiteam.v4.earlier.open", { day })} className={`flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base font-medium hover:bg-surface-2 ${i.date === current ? "bg-surface-2" : ""}`}>
                  <span>{day}</span>
                  {i.seconds !== null ? <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted tabular-nums">{i.seconds >= 60 ? w(words, "aiteam.v4.min", { n: String(Math.round(i.seconds / 60)) }) : w(words, "aiteam.standup.seconds", { seconds: String(i.seconds) })}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The report tab: the scene and its words on the left, tomorrow's to do and the earlier reports on the right (one column on a phone: scene, words, to do, earlier). */
export function ReportLayout({ scene, side }: { scene: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start" data-part="report-layout">
      {scene}
      <div className="flex flex-col gap-6">{side}</div>
    </div>
  );
}
