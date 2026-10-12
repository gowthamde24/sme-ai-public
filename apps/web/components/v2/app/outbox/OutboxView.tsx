import Link from "next/link";

import type { OutboxMessage, OutboxSettings, OutboxSummary } from "@/lib/api/outbox";
import type { SchedulerStatus } from "@/lib/api/scheduler";

import { indiaClock } from "../today/time";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, field, secondary } from "../visits/styles";
import { FreshPhotos } from "../catalogue/FreshPhotos";
import { OutboxList, type OutboxActions } from "./OutboxList";
import { SendingBanner } from "./SendingBanner";
import { TABS, type OutboxTab } from "./reasons";
import { presetDates, type LogFilters } from "./outbox-time";
import { schedulerView } from "./scheduler-line";

export type OutboxViewProps = {
  /** The "?" tip of the screen (job BT): drawn under the heading. */
  help?: React.ReactNode;
  tab: OutboxTab;
  /** The customer's name and the two India dates: the server has already applied them. */
  filters: LogFilters;
  role: Role;
  /** The moment the page was drawn (ms): read once so the page and a test agree. */
  now: number;
  lang: string;
  base: string;
  words: TodayWords;
  /** null = the list could not be read. */
  items: readonly OutboxMessage[] | null;
  /** The counts behind the four tabs (with the same filters) and what Dispatch would act on; null = could not be read. */
  counts: OutboxSummary | null;
  /** Older messages exist: the cursor for the link. */
  more: string | null;
  /** null = could not be read, or the role may not read them (Sales). */
  settings: OutboxSettings | null;
  scheduler: SchedulerStatus | null;
  actions: OutboxActions | null;
};

const tabLink = (on: boolean) =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-center text-base leading-tight max-md:py-1.5 md:-mb-px md:shrink-0 md:rounded-none md:border-0 md:border-b-2 md:px-4 md:whitespace-nowrap ${on ? "border-brand-edge bg-brand-bg font-semibold text-brand-text md:bg-transparent" : "border-edge font-medium text-muted hover:text-ink md:border-transparent"}`;

/** Agent OWL's last check, in words: "last checked 2 min ago · next check 14:03", or the calm warning when it has not run for more than five minutes while it should. */
function SchedulerLine({ s, now, words }: { s: SchedulerStatus; now: number; words: TodayWords }) {
  const v = schedulerView(s, now);
  if (v.state === "stale")
    return (
      <p role="status" data-scheduler="stale" className="rounded-2xl border border-amber-text bg-amber-bg px-4 py-3 text-sm font-medium text-amber-text">
        {say(words, "outbox.sched.stale", { minutes: v.minutes })}
      </p>
    );
  if (v.state === "never")
    return (
      <p data-scheduler="never" className="text-sm text-muted">
        {say(words, "outbox.sched.never")}
      </p>
    );
  return (
    <p data-scheduler="calm" className="text-sm text-muted">
      {v.minutes < 1 ? say(words, "outbox.sched.now") : say(words, "outbox.sched.ago", { minutes: v.minutes })}
      {v.next && Date.parse(v.next) > now ? ` · ${say(words, "outbox.sched.next", { time: indiaClock(v.next) })}` : ""}
      {v.off ? ` · ${say(words, v.off === "system" ? "outbox.sched.off.system" : "outbox.sched.off.business")}` : ""}
    </p>
  );
}

/** The Outbox page (job AX), drawn from what the server read: it only draws; a part that could not be read says "Not available yet" in its place. */
export function OutboxView(p: OutboxViewProps) {
  const { tab, words, base, role, filters } = p;
  const query = (f: LogFilters, over: { tab?: OutboxTab; after?: string } = {}) => {
    const q = new URLSearchParams({ tab: over.tab ?? tab });
    if (f.q) q.set("q", f.q);
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
    if (over.after) q.set("after", over.after);
    return `${base}/outbox?${q.toString()}`;
  };
  const href = (over: { tab?: OutboxTab; after?: string } = {}) => query(filters, over);
  const admin = role === "owner" || role === "admin";
  const presets = presetDates(p.now);
  const filtered = filters.q !== "" || filters.from !== null || filters.to !== null;
  const count = (t: OutboxTab): number | null => (p.counts ? p.counts[t] : null);
  return (
    <div data-screen="outbox" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.outbox")}</h1>
        <p className="text-base text-muted">{say(words, "outbox.sub")}</p>
        {admin && p.scheduler ? <SchedulerLine s={p.scheduler} now={p.now} words={words} /> : null}
      </header>
      {p.help}
      {p.settings?.platform_switch_on === false ? <SendingBanner words={words} /> : null}
      {p.settings && p.settings.platform_switch_on && !p.settings.auto_send_enabled ? (
        <p data-note="auto-off" className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          {say(words, "outbox.autooff")}
          {role === "owner" ? (
            <>
              {" "}
              <Link href={`${base}/settings?section=agent`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
                {say(words, "outbox.autooff.link")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <nav aria-label={say(words, "nav.item.outbox")} className="grid grid-cols-2 gap-2 md:flex md:gap-0 md:border-b md:border-line">
        {TABS.map((t) => (
          <Link key={t} href={href({ tab: t })} aria-current={t === tab ? "page" : undefined} className={tabLink(t === tab)}>
            {say(words, `outbox.tab.${t}`)}
            {count(t) !== null && (count(t) as number) > 0 ? (
              <span data-count={t} className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-sm font-bold ${t === "waiting" ? "bg-brand text-on-brand" : "bg-surface-2 text-ink"}`}>
                <span aria-hidden="true">{(count(t) as number) > 999 ? "999+" : count(t)}</span>
                <span className="sr-only">{say(words, `outbox.tab.count.${t}`, { n: count(t) as number })}</span>
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <form method="get" action={`${base}/outbox`} className="flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="tab" value={tab} />
        <div className="min-w-48 flex-1">
          <label htmlFor="outbox-q" className="mb-1.5 block text-sm font-semibold">
            {say(words, "outbox.search")}
          </label>
          <input id="outbox-q" name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder={say(words, "outbox.search.placeholder")} className={field} />
        </div>
        <div>
          <label htmlFor="outbox-from" className="mb-1.5 block text-sm font-semibold">
            {say(words, "outbox.from")}
          </label>
          <input id="outbox-from" name="from" type="date" defaultValue={filters.from ?? ""} className={`${field} w-auto`} />
        </div>
        <div>
          <label htmlFor="outbox-to" className="mb-1.5 block text-sm font-semibold">
            {say(words, "outbox.to")}
          </label>
          <input id="outbox-to" name="to" type="date" defaultValue={filters.to ?? ""} className={`${field} w-auto`} />
        </div>
        <button type="submit" className={secondary}>
          {say(words, "outbox.filter")}
        </button>
      </form>
      <p className="flex flex-wrap items-center gap-x-4 text-sm" data-part="quick-dates">
        <Link href={query({ ...presets.today, q: filters.q })} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
          {say(words, "outbox.range.today")}
        </Link>
        <Link href={query({ ...presets.week, q: filters.q })} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
          {say(words, "outbox.range.7d")}
        </Link>
        {filtered ? (
          <Link href={`${base}/outbox?tab=${tab}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
            {say(words, "outbox.clear")}
          </Link>
        ) : null}
      </p>

      {p.items === null ? (
        <div className={card}>
          <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
        </div>
      ) : (
        <>
          <FreshPhotos seconds={p.items.some((m) => m.media.length > 0) ? 600 : null}>
            <OutboxList key={`${tab}-${filters.q}-${filters.from}-${filters.to}`} items={p.items} tab={tab} role={role} words={words} lang={p.lang} now={p.now} actions={p.actions} leadBase={`${base}/leads`} counts={p.counts} quiet={p.settings ? { start: p.settings.quiet_hours_start, end: p.settings.quiet_hours_end } : null} filtered={filtered} />
          </FreshPhotos>
          {p.more ? (
            <Link href={href({ after: p.more })} className="inline-flex min-h-11 items-center self-start font-semibold text-brand-text hover:underline">
              {say(words, "outbox.older")}
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}
