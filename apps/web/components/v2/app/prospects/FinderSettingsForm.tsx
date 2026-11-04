"use client";

import { useId, useState } from "react";

import { RANGES, SETTINGS_FIELDS, settingsChanges, type FinderSettings, type SettingsField } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, help, label as labelClass, muted, okLine, primary, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";

const LABEL: Record<SettingsField, string> = { fitBar: "lf.set.fit", dailyCallCap: "lf.set.cap", callFromHour: "lf.set.from", callToHour: "lf.set.to", searchesPerDay: "lf.set.searches", resultsPerSearch: "lf.set.results" };
const HELP: Partial<Record<SettingsField, string>> = { fitBar: "lf.set.fit.help", callToHour: "lf.set.hours.help" };

/**
 * Settings -> Lead Finder (job lead-finder part D, contract section 6; Owner and Admin): the fit bar, the calls a day, the calling hours, the searches a day and the results per search. Each is a whole number in the contract's range,
 * the calling hours start before they end, and only what changed is sent (the PUT takes a subset). A problem is said next to its field before anything is sent; the API checks again.
 */
export function FinderSettingsForm({ words, initial, save }: { words: Words; initial: FinderSettings; save: (changes: Partial<Record<SettingsField, number>>) => Promise<Reply<FinderSettings>> }) {
  const t = makeT(words);
  const id = useId();
  const [stored, setStored] = useState(initial);
  const [typed, setTyped] = useState<Record<SettingsField, string>>(() => Object.fromEntries(SETTINGS_FIELDS.map((f) => [f, String(initial[f])])) as Record<SettingsField, string>);
  const [problem, setProblem] = useState<{ field: SettingsField; text: string } | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setDone(null);
    setFailure(null);
    const check = settingsChanges(stored, typed);
    if (!check.ok) {
      const [min, max] = RANGES[check.problem.field];
      return setProblem({ field: check.problem.field, text: check.problem.kind === "hours" ? t("lf.set.err.hours") : t("lf.set.err.range", { min, max }) });
    }
    setProblem(null);
    if (Object.keys(check.changes).length === 0) return setDone(t("lf.set.nochange"));
    setBusy(true);
    let r: Reply<FinderSettings>;
    try {
      r = await save(check.changes);
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setStored(r.data);
    setTyped(Object.fromEntries(SETTINGS_FIELDS.map((f) => [f, String(r.data[f])])) as Record<SettingsField, string>);
    setDone(t("lf.set.saved"));
  }

  return (
    <section className={card} aria-labelledby={`${id}-title`} data-finder-settings="">
      <h2 id={`${id}-title`} className={h2}>
        {t("lf.set.tab")}
      </h2>
      <p className={muted}>{t("lf.set.intro")}</p>
      <form
        noValidate
        className="grid gap-x-4 gap-y-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {SETTINGS_FIELDS.map((f) => {
          const [min, max] = RANGES[f];
          const wrong = problem?.field === f;
          return (
            <div key={f} className={f === "fitBar" ? "sm:col-span-2" : undefined}>
              <label htmlFor={`${id}-${f}`} className={labelClass}>
                {t(LABEL[f])}
              </label>
              <input
                id={`${id}-${f}`}
                name={f}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={typed[f]}
                onChange={(e) => setTyped((now) => ({ ...now, [f]: e.target.value }))}
                aria-invalid={wrong || undefined}
                aria-describedby={wrong ? `${id}-${f}-err` : HELP[f] ? `${id}-${f}-help` : undefined}
                className={`${field} max-w-40`}
              />
              {HELP[f] ? (
                <p id={`${id}-${f}-help`} className={help}>
                  {t(HELP[f])}
                </p>
              ) : null}
              {wrong ? (
                <p id={`${id}-${f}-err`} role="alert" className="mt-1.5 text-sm font-medium text-red-text">
                  {problem.text}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <div>
            <button type="submit" disabled={busy} className={`${primary} write-ctl`}>
              {busy ? t("lf.working") : t("lf.set.save")}
            </button>
          </div>
          <FailureNote failure={failure} words={words} />
          {done ? (
            <p role="status" className={okLine}>
              {done}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
