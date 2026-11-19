"use client";

import { ChevronDown } from "lucide-react";
import { Fragment } from "react";

import { HOUR_KEYS, fmtHhmm, type JobSetting, type SettingLine } from "@/lib/jobs/detail";

import { Tick } from "../../ds/Tick";
import type { Say } from "../../words";

/** The label of one choice: a time as "9:30 am", else the words `jobs.opt.<key>.<value>`; a value the web has no words for shows as it is (never blank). */
export function optionLabel(t: Say, key: string, value: string): string {
  if (HOUR_KEYS.includes(key)) return fmtHhmm(value);
  const k = `jobs.opt.${key}.${value}`;
  const s = t(k);
  return s === k ? value : s;
}

/** A choice made to look like a pill inside a sentence (the mock's `.sel`): a real native select, so the keyboard, the screen reader and the phone's own picker all work. */
export function PillSelect({ label, value, options, optionText, disabled, onChange }: { label: string; value: string; options: readonly string[]; optionText: (v: string) => string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <span className="relative my-0.5 inline-block align-middle">
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="jb-press write-ctl min-h-10 cursor-pointer appearance-none rounded-full border border-transparent bg-brand-bg py-1 pl-3.5 pr-8 text-[16px] font-semibold text-brand-text disabled:cursor-default disabled:opacity-80">
        {options.map((o) => (
          <option key={o} value={o}>
            {optionText(o)}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-brand-text" />
    </span>
  );
}

/**
 * One line of settings as a sentence with the choice inside ("Call new enquiries [right away]"). The sentence is `jobs.line.<id>` with `{key}` where each choice goes; a tick (a yes or no) is its own line with the sentence as its label.
 * The selects have names for the screen reader: the whole sentence without the choice markers.
 */
export function SettingLineView({ line, byKey, values, t, disabled, onChange }: { line: SettingLine; byKey: ReadonlyMap<string, JobSetting>; values: Readonly<Record<string, string>>; t: Say; disabled: boolean; onChange: (key: string, value: string) => void }) {
  const first = byKey.get(line.keys[0]);
  if (!first) return null;
  if (first.type === "toggle") {
    return <Tick data-setting={first.key} label={t(`jobs.line.${first.key}`)} checked={values[first.key] === "on"} disabled={disabled} onChange={(e) => onChange(first.key, e.target.checked ? "on" : "off")} />;
  }
  const template = t(`jobs.line.${line.id}`);
  const plain = template.replace(/\{\w+\}/g, "…");
  const many = line.keys.length > 1;
  return (
    <p data-setting-line={line.id} className="m-0 text-[16px] leading-[2.3] text-ink">
      {template.split(/(\{\w+\})/g).map((part, i) => {
        const key = /^\{(\w+)\}$/.exec(part)?.[1];
        const s = key ? byKey.get(key) : undefined;
        if (!s) return <Fragment key={i}>{part}</Fragment>;
        return <PillSelect key={i} label={many ? `${plain} (${line.keys.indexOf(s.key) + 1})` : plain} value={values[s.key] ?? s.value} options={s.options} optionText={(v) => optionLabel(t, s.key, v)} disabled={disabled} onChange={(v) => onChange(s.key, v)} />;
      })}
    </p>
  );
}
