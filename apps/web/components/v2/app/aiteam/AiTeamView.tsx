"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { markHref, type AiTeamDay, type FlowKey, type Helper, type Lane } from "@/lib/api/ai-team";

import type { SwitchFn } from "./HelperPanel";
import { HelperPanel } from "./LazyHelperPanel";
import { LANE_TONE, axisOf, clock, clockOf, dayList, duration, fill, minuteOfDay, pct, place, rupees, shown, statusWords, type Axis, type Placed } from "./shift";

const POLL_MS = 20_000;

/**
 * My AI team v2 (job ai-team-v2, owner 6 Nov 2026): the flow strip on top (each number filters the timeline), the day picker (Today, Yesterday, a day up to 31 back), and "today's shift": a lane per helper over the working day with a
 * moving now line, a mark per real action (a call's bar is as long as the call; an orange ⚑ waits for the owner), hover for one line, click to open the item, and the live status with today's count at each lane's end. A phone gets a
 * vertical day (time on the left, the helper as a coloured chip). Today's day is read again every 20 seconds while the page is in front; the first paint is the server's.
 */
export function AiTeamView({
  tenantId,
  base,
  date,
  today,
  initialDay,
  words,
  manages,
  onSwitch,
  mfaHref,
  standup,
  tab,
  quiet = false,
}: {
  tenantId: string;
  base: string;
  date: string;
  today: string;
  initialDay: AiTeamDay;
  words: Readonly<Record<string, string>>;
  manages: boolean;
  onSwitch: SwitchFn | null;
  mfaHref: string;
  /** The stand-up card (Owner and Admin), drawn above the flow strip. */
  standup?: React.ReactNode;
  /** app v4: the part of the page this is (a day picked here stays in it) */
  tab?: string;
  /** app v4: the helper panel has no switch and no settings links yet (stubs on the API side) */
  quiet?: boolean;
}) {
  const w = React.useCallback((k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars), [words]);
  const router = useRouter();
  const live = date === today;
  const [day, setDay] = React.useState(initialDay);
  const [fetchedAt, setFetchedAt] = React.useState(() => Date.now());
  const [stale, setStale] = React.useState(false);
  const [filter, setFilter] = React.useState<FlowKey | null>(null);
  const [helper, setHelper] = React.useState<Helper | null>(null);
  const [tick, setTick] = React.useState(() => Date.now());

  const reload = React.useCallback(async () => {
    try {
      const r = await fetch(`${base}/ai-team/day?${new URLSearchParams({ date }).toString()}`, { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      // our own route already read the API strictly (lib/api/ai-team.ts parseDay): its answer is the parsed day
      const next = ((await r.json()) as { day: AiTeamDay }).day;
      if (!next || !Array.isArray(next.lanes)) throw new Error("day");
      setDay(next);
      setFetchedAt(Date.now());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [base, date]);
  // the live day: every 20 s while the tab is in front (and once more when it comes back)
  React.useEffect(() => {
    if (!live) return;
    const poll = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const id = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [live, reload]);
  const busy = day.lanes.some((l) => l.statusNow?.kind === "busy");
  // the clock: every second while a call runs (its timer), else every 15 s (the now line)
  React.useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick(Date.now()), busy ? 1000 : 15_000);
    return () => window.clearInterval(id);
  }, [live, busy]);

  // "now" is the API's, moved on by the time since it was read (never the browser's own clock zone)
  const nowMs = Date.parse(day.now) + Math.max(0, tick - fetchedAt);
  const nowMinute = live ? minuteOfDay(new Date(nowMs).toISOString()) : null;
  const axis = axisOf(day, nowMinute);
  const filtered = filter !== null;
  const anyMark = day.lanes.some((l) => shown(l.marks, filter).length > 0);
  const stepWord = (k: FlowKey) => w(`aiteam.flow.${k}`);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
  const go = (d: string) => {
    const q = new URLSearchParams({ ...(tab ? { tab } : {}), ...(d === today ? {} : { date: d }) }).toString();
    router.push(q ? `${base}/ai-team?${q}` : `${base}/ai-team`);
  };
  const elapsedOf = (since: string | null) => (since ? Math.round((nowMs - Date.parse(since)) / 1000) : null);
  const helperWord = (h: Helper) => w(`aiteam.helper.${h}`);
  const tipOf = (m: Placed) =>
    [m.before ? w("aiteam.since", { when: `${m.t.slice(8, 10)}/${m.t.slice(5, 7)} ${clockOf(m.t)}` }) : clockOf(m.t), helperWord(m.helper), m.label, m.seconds ? duration(m.seconds) : null, m.needsOwner ? `⚑ ${w("aiteam.flag")}` : null].filter(Boolean).join(" · ");

  return (
    <div data-aiteam="" className="mt-4 flex flex-col gap-5">
      {standup}
      {/* the day: Today, Yesterday, or a day up to 31 days back */}
      <div className="flex flex-wrap items-center gap-2" data-part="days">
        <DayChip on={date === today} onClick={() => go(today)}>
          {w("aiteam.today")}
        </DayChip>
        <DayChip on={date === yesterday} onClick={() => go(yesterday)}>
          {w("aiteam.yesterday")}
        </DayChip>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted">
          <span>{w("aiteam.pickday")}</span>
          <input type="date" value={date} min={oldest} max={today} onChange={(e) => e.target.value && go(e.target.value)} className="min-h-11 rounded-lg border border-edge bg-surface px-2 text-base text-ink" />
        </label>
        {live ? (
          <span className="ml-auto inline-flex items-center gap-2 text-sm text-muted" data-part="live">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-green-text" />
            {stale ? w("aiteam.stale", { time: clockOf(new Date(fetchedAt).toISOString()) }) : w("aiteam.live")}
          </span>
        ) : null}
      </div>

      {/* the flow strip: leads in → called → interested → quotes → orders · cost today (school: enquiries → called → campus visits → admissions, fees apart) */}
      <nav aria-label={w("aiteam.flow.label")} data-part="flow" className="rounded-xl border border-line bg-surface p-3 shadow-[var(--v2-shadow)]">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {day.flow.steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 ? (
                <span aria-hidden="true" className="px-1 text-muted">
                  →
                </span>
              ) : null}
              <FlowButton on={filter === s.key} onClick={() => setFilter(filter === s.key ? null : s.key)} count={s.count} word={stepWord(s.key)} k={s.key} />
            </li>
          ))}
          {day.flow.extra.map((s) => (
            <li key={s.key} className="flex items-center gap-1">
              <span aria-hidden="true" className="px-1 text-muted">
                ·
              </span>
              <FlowButton on={filter === s.key} onClick={() => setFilter(filter === s.key ? null : s.key)} count={s.count} word={stepWord(s.key)} k={s.key} />
            </li>
          ))}
          {day.costToday?.paise != null ? (
            <li className="flex items-center gap-1 text-base text-muted" data-part="cost">
              <span aria-hidden="true" className="px-1">
                ·
              </span>
              {w("aiteam.flow.cost", { amount: rupees(day.costToday.paise) })}
            </li>
          ) : null}
        </ol>
        {filtered ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {w("aiteam.flow.showing", { step: stepWord(filter) })}
            <button type="button" onClick={() => setFilter(null)} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-brand-text hover:underline">
              {w("aiteam.flow.all")}
            </button>
          </p>
        ) : null}
      </nav>

      <section aria-labelledby="shift-title" className="rounded-xl border border-line bg-surface p-3 shadow-[var(--v2-shadow)] sm:p-4">
        <h2 id="shift-title" className="mb-3 font-display text-xl font-bold">
          {live ? w("aiteam.shift") : w("aiteam.shift.past", { date: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` })}
        </h2>
        {!anyMark ? <p className="mb-3 text-base text-muted">{filtered ? w("aiteam.empty.filter") : live ? w("aiteam.empty") : w("aiteam.empty.past")}</p> : null}
        {/* desktop: the lanes over the working day (scrolls inside its own box when narrow) */}
        <div className="hidden overflow-x-auto md:block" data-part="lanes">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_14rem] items-end gap-x-3 pb-1">
              <span />
              <div className="relative h-6 text-xs text-muted" aria-hidden="true">
                {/* the hours, less the ones the "Now" label would cover */}
                {axis.hours.filter((h) => nowMinute === null || Math.abs(pct(axis, h) - pct(axis, nowMinute)) > 9).map((h) => (
                  <At key={h} left={pct(axis, h)}>
                    <span className="block -translate-x-1/2">{clock(h)}</span>
                  </At>
                ))}
                {nowMinute !== null ? (
                  <At left={pct(axis, nowMinute)}>
                    <span className="block w-max -translate-x-1/2 -translate-y-1 rounded-full bg-brand px-1.5 font-semibold text-white" data-part="now-label">
                      {w("aiteam.now")} {clock(nowMinute)}
                    </span>
                  </At>
                ) : null}
              </div>
              <span />
            </div>
            <ul aria-label={w("aiteam.lanes")}>
              {day.lanes.map((lane) => (
                <LaneRow key={lane.helper} lane={lane} day={day} axis={axis} filter={filter} nowMinute={nowMinute} base={base} name={helperWord(lane.helper)} w={w} tip={tipOf} elapsed={elapsedOf(lane.statusNow?.since ?? null)} live={live} onOpen={() => setHelper(lane.helper)} />
              ))}
            </ul>
          </div>
        </div>
        {/* phone: the helpers as chips, then the day from top to bottom */}
        <div className="md:hidden" data-part="phone-day">
          <ul className="mb-3 flex flex-wrap gap-2" aria-label={w("aiteam.lanes")}>
            {day.lanes.map((lane) => {
              const s = statusWords(lane.statusNow, elapsedOf(lane.statusNow?.since ?? null));
              return (
                <li key={lane.helper}>
                  <button type="button" onClick={() => setHelper(lane.helper)} data-lane-open={lane.helper} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold ${LANE_TONE[lane.helper].chip} ${lane.enabled ? "" : "opacity-70"}`}>
                    <span>{helperWord(lane.helper)}</span>
                    {s ? <span className="font-normal">· {w(s.key, s.vars)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <PhoneDay list={dayList(day, axis, filter)} nowMinute={nowMinute} base={base} helperWord={helperWord} w={w} />
        </div>
      </section>
      {helper ? <HelperPanel key={helper} tenantId={tenantId} base={base} helper={helper} name={helperWord(helper)} words={words} manages={manages} onSwitch={onSwitch} mfaHref={mfaHref} onClose={() => setHelper(null)} onChanged={() => void reload()} quiet={quiet} /> : null}
    </div>
  );
}

function DayChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base font-semibold ${on ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink hover:border-brand-edge"}`}>
      {children}
    </button>
  );
}

function FlowButton({ on, onClick, count, word, k }: { on: boolean; onClick: () => void; count: number; word: string; k: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-flow={k} className={`inline-flex min-h-11 items-baseline gap-1.5 rounded-lg px-2.5 text-base ${on ? "bg-brand-bg text-brand-text" : "text-ink hover:bg-surface-2"}`}>
      <span className="font-display text-xl font-bold">{count}</span>
      <span>{word}</span>
    </button>
  );
}

function LaneRow({ lane, day, axis, filter, nowMinute, base, name, w, tip, elapsed, live, onOpen }: { lane: Lane; day: AiTeamDay; axis: Axis; filter: FlowKey | null; nowMinute: number | null; base: string; name: string; w: (k: string, v?: Record<string, string>) => string; tip: (m: Placed) => string; elapsed: number | null; live: boolean; onOpen: () => void }) {
  const tone = LANE_TONE[lane.helper];
  const marks = shown(lane.marks, filter).map((m) => place(day, lane, m, axis));
  const s = statusWords(lane.statusNow, elapsed);
  const span = axis.end - axis.start;
  return (
    <li className="grid grid-cols-[11rem_minmax(0,1fr)_14rem] items-center gap-x-3 border-t border-line" data-lane={lane.helper}>
      <button type="button" onClick={onOpen} data-lane-open={lane.helper} aria-label={w("aiteam.open", { helper: name })} className="flex min-h-14 items-center gap-2 rounded-lg px-1 text-left text-base font-semibold text-ink hover:text-brand-text">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${lane.enabled ? tone.dot : "bg-muted"}`} />
        <span className={`min-w-0 [overflow-wrap:anywhere] ${lane.enabled ? "" : "text-muted"}`}>{name}</span>
      </button>
      <div className="relative h-14" data-track="">
        {axis.hours.map((h) => (
          <At key={h} left={pct(axis, h)}>
            <span aria-hidden="true" className="block h-full w-px bg-line" />
          </At>
        ))}
        {nowMinute !== null ? (
          <At left={pct(axis, nowMinute)}>
            <span aria-hidden="true" data-part="now" className="block h-full w-0.5 bg-brand" />
          </At>
        ) : null}
        {marks.map((m) => {
          const href = markHref(base, m.ref);
          const left = pct(axis, m.minute);
          const bar = m.kind === "call" && m.seconds ? Math.max(0.6, (m.seconds / 60 / span) * 100) : null;
          const text = tip(m);
          const body = m.needsOwner ? (
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white shadow">
              ⚑
            </span>
          ) : bar !== null ? (
            <span aria-hidden="true" className={`block h-3 w-full min-w-2 rounded-full ${tone.mark}`} />
          ) : (
            <span aria-hidden="true" className={`block size-3 rounded-full ring-2 ring-surface ${tone.mark} ${m.kind === "followup_due" ? "opacity-40" : ""}`} />
          );
          const asBar = bar !== null && !m.needsOwner;
          const cls = `group relative flex h-full items-center ${asBar ? "w-full min-w-2" : "min-w-8 -translate-x-1/2 justify-center"} rounded-full focus-visible:outline-2`;
          return (
            <At key={m.id} left={left} {...(asBar ? { width: bar } : {})} {...(m.needsOwner ? { z: 10 } : {})}>
              {href ? (
                <Link href={href} aria-label={text} className={cls} data-mark={m.kind} data-owner={m.needsOwner ? "" : undefined}>
                  {body}
                  <Tip text={text} />
                </Link>
              ) : (
                <span tabIndex={0} aria-label={text} className={cls} data-mark={m.kind}>
                  {body}
                  <Tip text={text} />
                </span>
              )}
            </At>
          );
        })}
      </div>
      <div className="flex flex-col py-2 text-sm" data-part="status">
        {s ? (
          <span className={`font-semibold ${lane.statusNow?.kind === "waiting" || (lane.statusNow?.kind === "paused" && lane.statusNow.count) ? "text-brand-text" : lane.statusNow?.kind === "busy" ? "text-green-text" : lane.statusNow?.kind === "paused" ? "text-muted" : "text-ink"}`}>
            {lane.statusNow?.kind === "busy" ? "● " : ""}
            {w(s.key, s.vars)}
          </span>
        ) : null}
        <span className="text-muted">{w(live ? "aiteam.count" : "aiteam.count.day", { count: String(lane.countToday) })}</span>
      </div>
    </li>
  );
}

/** A place on the axis (`left` and `width` in percent of the track), as plain style only: the box inside carries the classes (the leak audit: no element has both). */
function At({ left, width, z, children }: { left: number; width?: number; z?: number; children: React.ReactNode }) {
  return <span style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, ...(width !== undefined ? { width: `${width}%` } : {}), ...(z !== undefined ? { zIndex: z } : {}) }}>{children}</span>;
}

/** The one-line detail of a mark, on hover and on keyboard focus (also its accessible name). */
function Tip({ text }: { text: string }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[22rem] -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-[var(--v2-shadow-pop)] group-hover:block group-focus-visible:block">
      {text}
    </span>
  );
}

function PhoneDay({ list, nowMinute, base, helperWord, w }: { list: Placed[]; nowMinute: number | null; base: string; helperWord: (h: Helper) => string; w: (k: string, v?: Record<string, string>) => string }) {
  const rows: React.ReactNode[] = [];
  let nowDrawn = nowMinute === null;
  for (const m of list) {
    if (!nowDrawn && !m.before && m.minute > (nowMinute as number)) {
      rows.push(<NowRow key="now" minute={nowMinute as number} word={w("aiteam.now")} />);
      nowDrawn = true;
    }
    const href = markHref(base, m.ref);
    const inner = (
      <>
        <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-muted">{m.before ? "⏳" : clockOf(m.t)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LANE_TONE[m.helper].chip}`}>{helperWord(m.helper)}</span>
            {m.needsOwner ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">⚑ {w("aiteam.flag")}</span> : null}
            {m.seconds ? <span className="text-xs text-muted">{duration(m.seconds)}</span> : null}
          </span>
          <span className={`text-base [overflow-wrap:anywhere] ${m.kind === "followup_due" ? "text-muted" : "text-ink"}`}>{m.label}</span>
          {m.before ? <span className="text-xs text-muted">{w("aiteam.since", { when: `${m.t.slice(8, 10)}/${m.t.slice(5, 7)} ${clockOf(m.t)}` })}</span> : null}
        </span>
      </>
    );
    rows.push(
      <li key={m.id} data-mark={m.kind} data-owner={m.needsOwner ? "" : undefined} className={`border-l-2 pl-3 ${m.needsOwner ? "border-brand" : "border-line"}`}>
        {href ? (
          <Link href={href} className="flex min-h-12 items-start gap-2 rounded-lg py-1.5 hover:bg-surface-2">
            {inner}
          </Link>
        ) : (
          <div className="flex min-h-12 items-start gap-2 py-1.5">{inner}</div>
        )}
      </li>,
    );
  }
  if (!nowDrawn) rows.push(<NowRow key="now" minute={nowMinute as number} word={w("aiteam.now")} />);
  return <ol className="flex flex-col">{rows}</ol>;
}

function NowRow({ minute, word }: { minute: number; word: string }) {
  return (
    <li aria-hidden="true" data-part="now" className="my-1 flex items-center gap-2">
      <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
        {word} {clock(minute)}
      </span>
      <span className="h-0.5 flex-1 bg-brand" />
    </li>
  );
}
