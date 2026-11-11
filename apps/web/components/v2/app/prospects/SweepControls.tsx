"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { HOURS, hourWord, RESULT_CHOICES, WEEKDAYS, DEFAULT_HOUR, DEFAULT_RESULTS, DEFAULT_WEEKDAY, sweepProblem } from "@/lib/lead-finder/sweeps";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, noteBox, warnBox } from "../ui";

type W = Readonly<Record<string, string>>;
type Failed = { ok: false; error: string };
type Reply = { ok: true; data: unknown } | Failed;
export type SweepActionsIn = {
  add: (input: { text: string; weekday: number; hour: number; maxResults: number }) => Promise<Reply>;
  change: (sweepId: string, change: { weekday?: number; hour?: number; maxResults?: number; enabled?: boolean }) => Promise<Reply>;
  run: (sweepId: string) => Promise<Reply>;
  remove: (sweepId: string) => Promise<Reply>;
};

const selectClass = `${fieldInput}`;
const when = (w: W, weekday: number, hour: number) => w["sw.when"].replace("{day}", w[`sw.day.${weekday}`]).replace("{time}", hourWord(hour));

function WhenFields({ w, weekday, hour, maxResults, set }: { w: W; weekday: number; hour: number; maxResults: number; set: (v: { weekday?: number; hour?: number; maxResults?: number }) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className={fieldLabel}>
          {w["sw.f.day"]}
          <select value={weekday} className={`${selectClass} mt-1.5 font-normal`} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {w[`sw.day.${d}`]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label className={fieldLabel}>
          {w["sw.f.hour"]}
          <select value={hour} className={`${selectClass} mt-1.5 font-normal`} onChange={(e) => set({ hour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourWord(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label className={fieldLabel}>
          {w["sw.f.cap"]}
          <select value={maxResults} className={`${selectClass} mt-1.5 font-normal`} onChange={(e) => set({ maxResults: Number(e.target.value) })}>
            {RESULT_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * "Add a weekly search" (Owner, Admin): the owner's own words, the day, the hour and how many businesses at most, then ONE clear second step that says what they are agreeing to (it runs by itself every week, it dials nobody, the
 * first 10 of every new search still wait for them) before anything is sent. Adding is the standing OK for exactly that search (C1's proposal). A refusal comes back in plain words.
 */
export function SweepAdd({ w, add }: { w: W; add: SweepActionsIn["add"] }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [weekday, setWeekday] = React.useState(DEFAULT_WEEKDAY);
  const [hour, setHour] = React.useState(DEFAULT_HOUR);
  const [maxResults, setMax] = React.useState(DEFAULT_RESULTS);
  const [step, setStep] = React.useState<"closed" | "edit" | "sure">("closed");
  const [problem, setProblem] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [busy, start] = React.useTransition();
  if (step === "closed")
    return (
      <div>
        <button type="button" className={btnQuiet} onClick={() => setStep("edit")} data-part="sweep-add-open">
          {w["sw.add"]}
        </button>
      </div>
    );
  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setFailed(null);
    const p = sweepProblem({ text, language: "en", weekday, hour, maxResults });
    if (p) return setProblem(p === "too_long" ? w["lf.find.too_long"] : w["lf.find.empty"]);
    setProblem(null);
    setStep("sure");
  };
  const send = () =>
    start(async () => {
      const out = await add({ text, weekday, hour, maxResults });
      if (out.ok) {
        setText("");
        setStep("closed");
        router.refresh();
        return;
      }
      setStep("edit");
      setFailed(out.error || w["sw.err.down"]);
    });
  if (step === "sure")
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4" data-part="sweep-sure" aria-labelledby="sw-sure-h">
        <p id="sw-sure-h" role="alert" className={`${warnBox} m-0 text-base font-bold`}>
          {w["sw.sure.title"]}
        </p>
        <p className="m-0 text-base font-semibold">{text.trim().replace(/\s+/g, " ")}</p>
        <p className="m-0 text-base">{w["sw.sure.body"].replace("{day}", w[`sw.day.${weekday}`]).replace("{time}", hourWord(hour)).replace("{n}", String(maxResults))}</p>
        <p className="m-0 text-sm text-muted">{w["sw.sure.cost"]}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btnMain} onClick={send} data-part="sweep-confirm">
            {busy ? w["sw.adding"] : w["sw.sure.yes"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setStep("edit")}>
            {w["sw.sure.no"]}
          </button>
        </div>
      </section>
    );
  return (
    <form className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2 p-4" onSubmit={check} noValidate data-part="sweep-form">
      {failed ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {failed}
        </p>
      ) : null}
      <div>
        <label htmlFor="sw-what" className={fieldLabel}>
          {w["sw.f.what"]}
        </label>
        <textarea id="sw-what" rows={2} value={text} placeholder={w["sw.f.what.help"]} aria-invalid={problem !== null} aria-describedby="sw-what-msg" className={fieldTextarea} onChange={(e) => (setText(e.target.value), setProblem(null))} />
        <p id="sw-what-msg" className={`${fieldHelp} ${problem ? "font-semibold text-red-text" : ""}`} aria-live="polite">
          {problem ?? w["sw.f.what.help"]}
        </p>
      </div>
      <WhenFields w={w} weekday={weekday} hour={hour} maxResults={maxResults} set={(v) => (v.weekday !== undefined && setWeekday(v.weekday), v.hour !== undefined && setHour(v.hour), v.maxResults !== undefined && setMax(v.maxResults))} />
      <p className={`${noteBox} m-0`}>{w["sw.nocall"]}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnMain} data-part="sweep-check">
          {w["sw.f.check"]}
        </button>
        <button type="button" className={btnQuiet} onClick={() => setStep("closed")}>
          {w["sw.cancel"]}
        </button>
      </div>
    </form>
  );
}

/** The buttons of one weekly search: Pause or Resume, Run now (asks first: it is a search today), Change the day, the time and the cap, Remove (asks first). Owner and Admin only (the page does not draw this for anyone else). */
export function SweepControls({ w, sweepId, enabled, weekday, hour, maxResults, actions }: { w: W; sweepId: string; enabled: boolean; weekday: number; hour: number; maxResults: number; actions: Pick<SweepActionsIn, "change" | "run" | "remove"> }) {
  const router = useRouter();
  const [ask, setAsk] = React.useState<null | "run" | "remove" | "change">(null);
  const [d, setD] = React.useState({ weekday, hour, maxResults });
  const [failed, setFailed] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  const [busy, start] = React.useTransition();
  const go = (fn: () => Promise<Reply>, ok?: string) =>
    start(async () => {
      const out = await fn();
      if (out.ok) {
        setFailed(null);
        setSaid(ok ?? null);
        setAsk(null);
        router.refresh();
      } else {
        setSaid(null);
        setFailed(out.error || w["sw.err.down"]);
        setAsk(null);
      }
    });
  return (
    <div className="flex flex-col gap-2" data-part="sweep-controls">
      {failed ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {failed}
        </p>
      ) : null}
      {said ? (
        <p role="status" className="m-0 text-sm font-semibold text-green-text">
          {said}
        </p>
      ) : null}
      {ask === "run" || ask === "remove" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{w[ask === "run" ? "sw.run.sure" : "sw.remove.sure"]}</span>
          <button type="button" disabled={busy} className={btnMain} onClick={() => go(() => (ask === "run" ? actions.run(sweepId) : actions.remove(sweepId)), ask === "run" ? w["sw.run.done"] : undefined)} data-part="sweep-yes">
            {w[ask === "run" ? "sw.run.yes" : "sw.remove.yes"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setAsk(null)}>
            {w["sw.cancel"]}
          </button>
        </div>
      ) : ask === "change" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3" data-part="sweep-change">
          <WhenFields w={w} weekday={d.weekday} hour={d.hour} maxResults={d.maxResults} set={(v) => setD({ ...d, ...v })} />
          <p className="m-0 text-sm text-muted">{when(w, d.weekday, d.hour)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={btnMain} onClick={() => go(() => actions.change(sweepId, d), w["sw.saved"])}>
              {w["sw.save"]}
            </button>
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => setAsk(null)}>
              {w["sw.cancel"]}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => go(() => actions.change(sweepId, { enabled: !enabled }))} data-part="sweep-toggle">
            {w[enabled ? "sw.pause" : "sw.resume"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setAsk("run")} data-part="sweep-run">
            {w["sw.run"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => (setD({ weekday, hour, maxResults }), setAsk("change"))}>
            {w["sw.change"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setAsk("remove")} data-part="sweep-remove">
            {w["sw.remove"]}
          </button>
        </div>
      )}
    </div>
  );
}
