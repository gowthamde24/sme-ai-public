"use client";

import Link from "next/link";
import * as React from "react";

import { EVENING_HOURS, HEADS_UP_MINUTES, NO_SHOW_MINUTES, type SchedulerSettings } from "@/lib/api/scheduler";
import { QUIET_END, QUIET_START, type OutboxSettings } from "@/lib/api/outbox";

import { say, type TodayWords } from "../today/today-words";
import { card, errorLine, field, help, label, okLine, primary } from "../visits/styles";
import type { AgentResult, AgentSettingsActions } from "./types";

const HEADS_UP = [60, 90, 120, 150, 180, 240, 300, 360, 420, 480];
const NO_SHOW = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
const hours = Array.from({ length: EVENING_HOURS.max - EVENING_HOURS.min + 1 }, (_, i) => EVENING_HOURS.min + i);
const withCurrent = (list: number[], value: number) => (list.includes(value) ? list : [...list, value].sort((a, b) => a - b));

function Switch({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-base font-semibold">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
      {children}
    </label>
  );
}

function Result({ words, r }: { words: TodayWords; r: AgentResult | null }) {
  if (!r) return null;
  if (r.ok)
    return (
      <p role="status" className={okLine}>
        {r.message}
      </p>
    );
  return (
    <p role="alert" className={errorLine}>
      {r.error}
      {r.mfa ? (
        <>
          {" "}
          <Link href="/app/security" className="font-semibold underline">
            {say(words, "today.err.mfa.link")}
          </Link>
        </>
      ) : null}
    </p>
  );
}

/** Runs a save: busy while it is out, then our sentence. Nothing is cleared on a refusal. */
function useSave(words: TodayWords) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<AgentResult | null>(null);
  const save = async (call: () => Promise<AgentResult>) => {
    setBusy(true);
    setResult(null);
    let r: AgentResult;
    try {
      r = await call();
    } catch {
      r = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    setResult(r);
  };
  return { busy, result, save };
}

/**
 * Automatic sending for this business (job AX): ONE switch, off until the Owner turns it on, and the daily limit of messages per customer. Saving needs the second factor (the refusal says so and points at Security).
 * The sentence under it says what the switch means in plain words; the system-wide switch (the operator's) is shown on its own card and cannot be changed here.
 */
export function SendingForm({ words, settings, save: saveAction }: { words: TodayWords; settings: OutboxSettings; save: AgentSettingsActions["saveSending"] }) {
  const [auto, setAuto] = React.useState(settings.auto_send_enabled);
  const [limit, setLimit] = React.useState(String(settings.per_customer_daily_limit));
  const { busy, result, save } = useSave(words);
  const n = Number(limit);
  const ok = Number.isInteger(n) && n >= 1 && n <= 20;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) void save(() => saveAction({ auto_send_enabled: auto, per_customer_daily_limit: n }));
      }}
      className={card}
      aria-labelledby="sending-heading"
      noValidate
    >
      <h2 id="sending-heading" className="font-display text-xl font-semibold">
        {say(words, "agentset.sending.title")}
      </h2>
      <Switch id="auto-send" checked={auto} onChange={setAuto}>
        {say(words, "agentset.sending.switch")}
      </Switch>
      <p className="text-base">{say(words, "agentset.sending.what")}</p>
      <p className="text-sm text-muted">{say(words, auto ? "agentset.sending.on" : "agentset.sending.off")}</p>
      <div className="max-w-xs">
        <label htmlFor="daily-limit" className={label}>
          {say(words, "agentset.limit")}
        </label>
        <input id="daily-limit" type="number" inputMode="numeric" min={1} max={20} value={limit} onChange={(e) => setLimit(e.target.value)} className={field} aria-invalid={!ok} />
        <p className={help}>{say(words, "agentset.limit.hint")}</p>
      </div>
      <Result words={words} r={result} />
      <div>
        <button type="submit" disabled={busy || !ok} className={primary}>
          {busy ? say(words, "today.act.working") : say(words, "agentset.save")}
        </button>
        <p className={help}>{say(words, "agentset.mfa")}</p>
      </div>
    </form>
  );
}

const QUIET_STARTS = Array.from({ length: QUIET_START.max - QUIET_START.min + 1 }, (_, i) => QUIET_START.min + i);
const QUIET_ENDS = Array.from({ length: QUIET_END.max - QUIET_END.min + 1 }, (_, i) => QUIET_END.min + i);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** True when the evening reminder (from `eveningHour` on) starts at or after the first quiet hour: the worker never queues a reminder in quiet hours, so there is then no evening reminder at all (the heads-up still goes). */
export const eveningInsideQuiet = (eveningEnabled: boolean, eveningHour: number, quietStart: number): boolean => eveningEnabled && eveningHour >= quietStart;

/**
 * Quiet hours (job BE on BB's API): no message goes out from the start hour (19:00 to 23:00) until the end hour (07:00 to 10:00), India time; what is due waits for the morning. The Owner only, with the second factor
 * (the refusal says so and points at Security). When the evening visit reminder falls inside the chosen hours, one sentence says there will be no evening reminder (the heads-up before the visit still goes): it follows the
 * start hour as it is picked, before saving.
 */
export function QuietHoursForm({ words, settings, reminders, save: saveAction }: { words: TodayWords; settings: OutboxSettings; reminders: SchedulerSettings | null; save: AgentSettingsActions["saveQuietHours"] }) {
  const [start, setStart] = React.useState(String(settings.quiet_hours_start));
  const [end, setEnd] = React.useState(String(settings.quiet_hours_end));
  const { busy, result, save } = useSave(words);
  const clash = reminders !== null && eveningInsideQuiet(reminders.reminder_evening_enabled, reminders.reminder_evening_hour, Number(start));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy)
          void save(() => saveAction({ quiet_hours_start: Number(start), quiet_hours_end: Number(end), auto_send_enabled: settings.auto_send_enabled, per_customer_daily_limit: settings.per_customer_daily_limit }));
      }}
      className={card}
      aria-labelledby="quiet-heading"
      data-card="quiet"
    >
      <h2 id="quiet-heading" className="font-display text-xl font-semibold">
        {say(words, "agentset.quiet.title")}
      </h2>
      <p className="text-sm text-muted">{say(words, "agentset.quiet.note")}</p>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <div>
          <label htmlFor="quiet-start" className={label}>
            {say(words, "agentset.quiet.start")}
          </label>
          <select id="quiet-start" value={start} onChange={(e) => setStart(e.target.value)} className={field}>
            {QUIET_STARTS.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="quiet-end" className={label}>
            {say(words, "agentset.quiet.end")}
          </label>
          <select id="quiet-end" value={end} onChange={(e) => setEnd(e.target.value)} className={field}>
            {QUIET_ENDS.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {clash && reminders ? (
        <p data-note="evening-inside-quiet" role="note" className="rounded-lg bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
          {say(words, "agentset.quiet.evening", { hour: hh(reminders.reminder_evening_hour), start: hh(Number(start)) })}
        </p>
      ) : null}
      <Result words={words} r={result} />
      <div>
        <button type="submit" disabled={busy} className={primary}>
          {busy ? say(words, "today.act.working") : say(words, "agentset.quiet.save")}
        </button>
        <p className={help}>{say(words, "agentset.mfa")}</p>
      </div>
    </form>
  );
}

/**
 * Visit reminders and the automatic "did not come" (job AW): the evening before from an hour (9 to 20, never after 21:00), a heads-up some minutes before (60 to 480), and the no-show mark some minutes after the slot
 * ended (5 to 720; off unless switched on). The worker only acts while both sending switches are on, whatever is set here, and never in quiet hours. Saving needs the second factor.
 */
export function RemindersForm({ words, settings, save: saveAction }: { words: TodayWords; settings: SchedulerSettings; save: AgentSettingsActions["saveReminders"] }) {
  const [evening, setEvening] = React.useState(settings.reminder_evening_enabled);
  const [hour, setHour] = React.useState(String(settings.reminder_evening_hour));
  const [heads, setHeads] = React.useState(settings.reminder_heads_up_enabled);
  const [mins, setMins] = React.useState(String(settings.reminder_heads_up_minutes));
  const [noShow, setNoShow] = React.useState(settings.no_show_enabled);
  const [after, setAfter] = React.useState(String(settings.no_show_after_minutes));
  const { busy, result, save } = useSave(words);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy)
          void save(() =>
            saveAction({
              reminder_evening_enabled: evening,
              reminder_evening_hour: Number(hour),
              reminder_heads_up_enabled: heads,
              reminder_heads_up_minutes: Number(mins),
              no_show_enabled: noShow,
              no_show_after_minutes: Number(after),
            }),
          );
      }}
      className={card}
      aria-labelledby="reminders-heading"
    >
      <h2 id="reminders-heading" className="font-display text-xl font-semibold">
        {say(words, "agentset.rem.title")}
      </h2>
      {settings.is_default ? <p className="rounded-lg bg-info-bg px-3 py-2 text-sm font-medium text-info-text">{say(words, "agentset.rem.default")}</p> : null}
      <p className="text-sm text-muted">{say(words, "agentset.rem.note")}</p>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <Switch id="rem-evening" checked={evening} onChange={setEvening}>
          {say(words, "agentset.rem.evening")}
        </Switch>
        <div className="max-w-xs">
          <label htmlFor="rem-hour" className={label}>
            {say(words, "agentset.rem.evening.from")}
          </label>
          <select id="rem-hour" value={hour} disabled={!evening} onChange={(e) => setHour(e.target.value)} className={field}>
            {hours.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <p className={help}>{say(words, "agentset.rem.evening.hint")}</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <Switch id="rem-heads" checked={heads} onChange={setHeads}>
          {say(words, "agentset.rem.heads")}
        </Switch>
        <div className="max-w-xs">
          <label htmlFor="rem-mins" className={label}>
            {say(words, "agentset.rem.heads.minutes")}
          </label>
          <select id="rem-mins" value={mins} disabled={!heads} onChange={(e) => setMins(e.target.value)} className={field}>
            {withCurrent(HEADS_UP, Number(mins)).map((m) => (
              <option key={m} value={m} disabled={m < HEADS_UP_MINUTES.min || m > HEADS_UP_MINUTES.max}>
                {say(words, "agentset.minutes", { n: m })}
              </option>
            ))}
          </select>
          <p className={help}>{say(words, "agentset.rem.heads.hint")}</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <Switch id="rem-noshow" checked={noShow} onChange={setNoShow}>
          {say(words, "agentset.noshow")}
        </Switch>
        <div className="max-w-xs">
          <label htmlFor="rem-after" className={label}>
            {say(words, "agentset.noshow.minutes")}
          </label>
          <select id="rem-after" value={after} disabled={!noShow} onChange={(e) => setAfter(e.target.value)} className={field}>
            {withCurrent(NO_SHOW, Number(after)).map((m) => (
              <option key={m} value={m} disabled={m < NO_SHOW_MINUTES.min || m > NO_SHOW_MINUTES.max}>
                {say(words, "agentset.minutes", { n: m })}
              </option>
            ))}
          </select>
          <p className={help}>{say(words, "agentset.noshow.hint")}</p>
        </div>
      </fieldset>

      <Result words={words} r={result} />
      <div>
        <button type="submit" disabled={busy} className={primary}>
          {busy ? say(words, "today.act.working") : say(words, "agentset.save")}
        </button>
        <p className={help}>{say(words, "agentset.mfa")}</p>
      </div>
    </form>
  );
}
