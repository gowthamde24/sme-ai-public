import Link from "next/link";

import type { OutboxMessage, OutboxSettings } from "@/lib/api/outbox";
import type { SchedulerStatus } from "@/lib/api/scheduler";

import { indiaClock } from "../today/time";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, field, secondary } from "../visits/styles";
import { OutboxList, type OutboxActions } from "./OutboxList";
import { SendingBanner } from "./SendingBanner";
import { TABS, type OutboxTab } from "./reasons";
import { RANGES, type Range } from "./outbox-time";
import { schedulerView } from "./scheduler-line";

export type OutboxViewProps = {
  tab: OutboxTab;
  range: Range;
  q: string;
  role: Role;
  /** The moment the page was drawn (ms): read once so the page and a test agree. */
  now: number;
  lang: string;
  base: string;
  words: TodayWords;
  /** null = the list could not be read. */
  items: readonly OutboxMessage[] | null;
  /** How many wait for a person (null = not known); 100 means "100 or more". */
  waiting: number | null;
  /** Older messages exist: the cursor for the link. */
  more: string | null;
  /** null = could not be read, or the role may not read them (Sales). */
  settings: OutboxSettings | null;
  scheduler: SchedulerStatus | null;
  actions: OutboxActions | null;
};

const tabLink = (on: boolean) => `-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-base whitespace-nowrap ${on ? "border-brand-edge font-semibold text-brand-text" : "border-transparent font-medium text-muted hover:text-ink"}`;

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
  const { tab, words, base, role } = p;
  const href = (over: Partial<{ tab: OutboxTab; range: Range; q: string; after: string }>) => {
    const q = new URLSearchParams({ tab: over.tab ?? tab, range: over.range ?? p.range });
    const text = over.q ?? p.q;
    if (text) q.set("q", text);
    if (over.after) q.set("after", over.after);
    return `${base}/outbox?${q.toString()}`;
  };
  const admin = role === "owner" || role === "admin";
  return (
    <div data-screen="outbox" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.outbox")}</h1>
        <p className="text-base text-muted">{say(words, "outbox.sub")}</p>
        {admin && p.scheduler ? <SchedulerLine s={p.scheduler} now={p.now} words={words} /> : null}
      </header>
      {p.settings?.platform_switch_on === false ? <SendingBanner words={words} /> : null}
      {p.settings && p.settings.platform_switch_on && !p.settings.auto_send_enabled ? (
        <p data-note="auto-off" className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          {say(words, "outbox.autooff")}
          {role === "owner" ? (
            <>
              {" "}
              <Link href={`${base}/settings?section=agent`} className="font-semibold text-brand-text underline">
                {say(words, "outbox.autooff.link")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <nav aria-label={say(words, "nav.item.outbox")} className="-mx-4 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <Link key={t} href={href({ tab: t, after: undefined })} aria-current={t === tab ? "page" : undefined} className={tabLink(t === tab)}>
            {say(words, `outbox.tab.${t}`)}
            {t === "waiting" && p.waiting !== null && p.waiting > 0 ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-sm font-bold text-on-brand">
                <span aria-hidden="true">{p.waiting >= 100 ? "100+" : p.waiting}</span>
                <span className="sr-only">{say(words, "outbox.tab.count", { n: p.waiting })}</span>
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <form method="get" action={`${base}/outbox`} className="flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="tab" value={tab} />
        <div>
          <label htmlFor="outbox-range" className="mb-1.5 block text-sm font-semibold">
            {say(words, "outbox.range")}
          </label>
          <select id="outbox-range" name="range" defaultValue={p.range} className={`${field} w-auto`}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {say(words, `outbox.range.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="outbox-q" className="mb-1.5 block text-sm font-semibold">
            {say(words, "outbox.search")}
          </label>
          <input id="outbox-q" name="q" type="search" maxLength={100} defaultValue={p.q} placeholder={say(words, "outbox.search.placeholder")} className={field} />
        </div>
        <button type="submit" className={secondary}>
          {say(words, "outbox.filter")}
        </button>
        {p.q || p.range !== "7d" ? (
          <Link href={`${base}/outbox?tab=${tab}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text hover:underline">
            {say(words, "outbox.clear")}
          </Link>
        ) : null}
      </form>

      {p.items === null ? (
        <div className={card}>
          <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
        </div>
      ) : (
        <>
          <OutboxList key={`${tab}-${p.range}-${p.q}`} items={p.items} tab={tab} role={role} words={words} lang={p.lang} now={p.now} actions={p.actions} leadBase={`${base}/leads`} />
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
