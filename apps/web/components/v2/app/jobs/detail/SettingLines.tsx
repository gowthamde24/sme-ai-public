"use client";

import { HOUR_KEYS, fmtHhmm, type JobSetting, type SettingLine } from "@/lib/jobs/detail";

import { ChevronDown } from "lucide-react";

import { Tick } from "../../ds/Tick";
import { SelectField } from "../../settings/simple/fields";
import type { Say } from "../../words";

/** The label of one choice: a time as "9:30 am", else the words `jobs.opt.<key>.<value>`; a value the web has no words for shows as it is (never blank). */
export function optionLabel(t: Say, key: string, value: string): string {
  if (HOUR_KEYS.includes(key)) return fmtHhmm(value);
  const k = `jobs.opt.${key}.${value}`;
  const s = t(k);
  return s === k ? value : s;
}

/** A choice made to look like a pill inside a sentence (the mock's `.sel`): a real native select, so the keyboard, the screen reader and the phone's own picker all work. */
export function PillSelect({ label, value, options, optionText, disabled, invalid = false, onChange }: { label: string; value: string; options: readonly string[]; optionText: (v: string) => string; disabled: boolean; /** the API refused this choice (`setting_invalid`): it is marked */ invalid?: boolean; onChange: (v: string) => void }) {
  return (
    <span className="relative my-0.5 inline-block max-w-full align-middle">
      <select aria-label={label} value={value} disabled={disabled} aria-invalid={invalid ? true : undefined} data-invalid={invalid ? "" : undefined} onChange={(e) => onChange(e.target.value)} className={`jb-press write-ctl min-h-10 max-w-full cursor-pointer text-ellipsis appearance-none rounded-full border ${invalid ? "border-red-text" : "border-[color:var(--v2-pill-edge)]"} bg-brand-bg py-1 pl-3.5 pr-8 text-[16px] font-semibold text-brand-text disabled:cursor-default disabled:opacity-80`}>
        {options.map((o) => (
          <option key={o} value={o} disabled={o === ""}>
            {optionText(o)}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-brand-text" />
    </span>
  );
}

/** The label of one setting: its own words for this kind of job (`jobs.f.<job>.<key>`, e.g. the opening hour of a store visit and the first calling hour of a call), else `jobs.f.<key>`. */
export function settingLabel(t: Say, kind: string | undefined, key: string): string {
  if (kind) {
    const own = t(`jobs.f.${kind}.${key}`);
    if (own !== `jobs.f.${kind}.${key}`) return own;
  }
  const k = `jobs.f.${key}`;
  const s = t(k);
  return s === k ? key.replace(/_/g, " ") : s;
}

/**
 * One setting of a job as a plain labelled field (owner, 25 Nov / 29 Nov 2026: no fill-in-the-blank sentences): the label above, the choice as a dropdown; a tick (a yes or no) is its own line with the label as its words.
 * The dropdown's name for the screen reader is its label.
 */
export function SettingLineView({ line, byKey, values, t, disabled, invalid = [], onChange, kind }: { line: SettingLine; byKey: ReadonlyMap<string, JobSetting>; values: Readonly<Record<string, string>>; t: Say; disabled: boolean; /** keys of the settings the API refused the last time: marked */ invalid?: readonly string[]; onChange: (key: string, value: string) => void; /** the job's kind: some settings have words of their own for it */ kind?: string }) {
  const first = byKey.get(line.keys[0]);
  if (!first) return null;
  if (first.type === "toggle") {
    return <Tick data-setting={first.key} label={t(`jobs.line.${first.key}`) !== `jobs.line.${first.key}` ? t(`jobs.line.${first.key}`) : settingLabel(t, kind, first.key)} checked={values[first.key] === "on"} disabled={disabled} onChange={(e) => onChange(first.key, e.target.checked ? "on" : "off")} />;
  }
  return (
    <div data-setting-line={line.id} className={line.keys.length > 1 ? "grid grid-cols-1 gap-4 min-[420px]:grid-cols-2" : "flex flex-col"}>
      {line.keys.map((key) => {
        const s = byKey.get(key);
        if (!s) return null;
        const label = settingLabel(t, kind, key);
        const value = values[s.key] ?? s.value;
        const options = value === "" && !s.options.includes("") ? ["", ...s.options] : s.options;
        return (
          <SelectField
            key={key}
            label={label}
            value={value}
            options={options.map((o) => ({ value: o, label: optionLabel(t, s.key, o), disabled: o === "" }))}
            disabled={disabled}
            invalid={invalid.includes(s.key)}
            onChange={(v) => onChange(s.key, v)}
          />
        );
      })}
    </div>
  );
}
