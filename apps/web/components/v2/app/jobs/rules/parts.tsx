"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { fmtMinutes } from "@/lib/jobs/detail";

import type { Say } from "../../words";
import { PillSelect } from "../detail/SettingLines";

/**
 * The small parts the rules and call settings share under JOBS (the simplicity pass): a sentence with the choice inside, a value shown as a pill, a number inside a sentence, the live "What it will do:" line, "More choices" on the same page, and the round-knob switch.
 * Everything is the design foundation of design/jobs.css and the "sentence with the choice inside" of the job page (PillSelect), so a rule and a job read alike.
 */

/** A sentence with `{name}` markers: each marker is replaced by what `parts[name]` draws, given the sentence without the markers (the choice's name for the screen reader). */
export function Sentence({ template, parts, line, className = "" }: { template: string; parts: Readonly<Record<string, (aria: string) => ReactNode>>; line: string; className?: string }) {
  const plain = template.replace(/\{\w+\}/g, "…");
  return (
    <p data-setting-line={line} className={`m-0 text-[16px] leading-[2.3] text-ink ${className}`.trim()}>
      {template.split(/(\{\w+\})/g).map((part, i) => {
        const key = /^\{(\w+)\}$/.exec(part)?.[1];
        const draw = key ? parts[key] : undefined;
        return draw ? <Fragment key={i}>{draw(plain)}</Fragment> : <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

/** A value that is read, not chosen here (a saved rule, the calling hours): the same pill as a choice, without the arrow. */
export function Val({ children }: { children: ReactNode }) {
  return <b className="mx-0.5 inline-block rounded-md bg-brand-bg px-3 py-0.5 align-middle text-[15px] font-semibold leading-snug text-brand-text">{children}</b>;
}

/** A choice from a list, as a pill inside a sentence. A value the list does not hold (an older saved one) is added, so what is saved always shows. */
export function Choose({ aria, value, options, text, disabled, onChange }: { aria: string; value: string; options: readonly string[]; text: (v: string) => string; disabled?: boolean; onChange: (v: string) => void }) {
  const list = options.includes(value) ? options : [value, ...options];
  return <PillSelect label={aria} value={value} options={list} optionText={text} disabled={disabled === true} onChange={onChange} />;
}

/** A number typed inside a sentence (a limit that has no fixed list). Empty is allowed when `empty` says what it means. */
export function PillNum({ aria, value, min, max, step = 1, placeholder, disabled, onChange }: { aria: string; value: string; min: number; max?: number; step?: number; placeholder?: string; disabled?: boolean; onChange: (v: string) => void }) {
  return <input type="number" inputMode="numeric" aria-label={aria} min={min} max={max} step={step} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="write-ctl mx-0.5 my-0.5 min-h-10 w-24 rounded-md border border-[color:var(--v2-pill-edge)] bg-brand-bg px-3 text-center align-middle text-[16px] font-semibold text-brand-text placeholder:font-normal placeholder:text-muted disabled:opacity-80" />;
}

/** "What it will do:" with one worked example (the same grey box as the job page). */
export function EffectBox({ label, text }: { label: string; text: string }) {
  return (
    <div data-part="effect" className="rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">
      <p className="m-0">
        <b>{label}</b> {text}
      </p>
    </div>
  );
}

/** "More choices" on the same page: closed by default; the rare things live inside (the same card part as the job page). */
export function MoreChoices({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <details data-part="more-choices" className="group rounded-xl border border-line px-3.5 py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-display text-[16px] font-bold leading-tight text-ink">{title}</span>
          <span className="block text-sm text-muted">{sub}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

/** The switch of one rule: a round knob that moves at once (the rule is put back if the change does not go through). A 44 px tap area. */
export function RuleSwitch({ label, on, busy, onChange }: { label: string; on: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)} className="jb-switch-hit write-ctl -my-2 -mr-2 grid min-h-11 min-w-11 shrink-0 place-items-center">
      <span className="jb-switch" aria-hidden="true" data-on={on ? "" : undefined} />
    </button>
  );
}

/* ---- the words of a choice: minutes as "within 5 minutes", a gap as "2 hours", a count as "2 more times", seconds as "1 min 30 s" ---- */
export const withCurrent = (list: readonly number[], current: number): readonly number[] => (list.includes(current) ? list : [...list, current].sort((a, b) => a - b));

export function withinText(t: Say, minutes: number): string {
  if (minutes === 0) return t("jobs.rules.w.now");
  if (minutes === 1) return t("jobs.rules.w.one");
  if (minutes % 60 === 0) return t(minutes === 60 ? "jobs.rules.w.hour" : "jobs.rules.w.hours", { n: minutes / 60 });
  return t("jobs.rules.w.min", { n: minutes });
}
export function gapText(t: Say, minutes: number): string {
  if (minutes % 60 === 0) return t(minutes === 60 ? "jobs.rules.g.hour" : "jobs.rules.g.hours", { n: minutes / 60 });
  return t("jobs.rules.g.min", { n: minutes });
}
export const countText = (t: Say, n: number): string => (n === 0 ? t("jobs.rules.n.0") : n === 1 ? t("jobs.rules.n.one") : t("jobs.rules.n.many", { n }));
export function secondsText(t: Say, s: number): string {
  if (s < 60) return t("jobs.rules.s.sec", { n: s });
  return s % 60 === 0 ? t("jobs.rules.s.min", { n: s / 60 }) : t("jobs.rules.s.minsec", { m: Math.floor(s / 60), s: s % 60 });
}
/** A time of day as "9:30 am"; a minute past midnight (the next day) is told as "tomorrow 9 am". */
export const clockWord = (t: Say, minute: number): string => (minute >= 1440 ? t("jobs.rules.cs.tomorrow", { t: fmtMinutes(minute) }) : fmtMinutes(minute));
