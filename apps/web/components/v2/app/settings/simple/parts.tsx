"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Tick } from "../../ds/Tick";

/**
 * The small parts of the Settings cards under JOBS (the simplicity pass; the sentence, the value pill, the effect box and "More choices" are the ones of the rules: `jobs/rules/parts`): a short text typed inside a sentence, and a choice of several (the languages) as ONE pill that opens a list of round ticks.
 */
export { EffectBox, MoreChoices, Sentence, Val } from "../../jobs/rules/parts";

/** A short text typed inside a sentence (a name, a city), drawn as a pill that grows with what is typed. */
export function PillText({ aria, name, value, onChange, placeholder, maxLength, minLength, required = false, inputMode, autoComplete, pattern, disabled = false }: { aria: string; name?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; minLength?: number; required?: boolean; inputMode?: "numeric" | "tel" | "text"; autoComplete?: string; pattern?: string; disabled?: boolean }) {
  const len = (value || placeholder || "").length + 3;
  const width = len <= 12 ? "w-[12ch]" : len <= 18 ? "w-[18ch]" : len <= 24 ? "w-[24ch]" : "w-[30ch]"; // (written out, so the style sheet has them)
  return <input type="text" name={name} aria-label={aria} value={value} placeholder={placeholder} maxLength={maxLength} minLength={minLength} required={required} inputMode={inputMode} autoComplete={autoComplete} pattern={pattern} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`write-ctl ${width} mx-0.5 my-0.5 min-h-10 max-w-full rounded-md border border-[color:var(--v2-pill-edge)] bg-brand-bg px-3.5 py-1 align-middle text-[16px] font-semibold text-brand-text placeholder:font-normal placeholder:text-muted focus:border-brand-edge disabled:opacity-80`} />;
}

/** The button of a choice of several, drawn as a pill inside a sentence (it opens `MultiPanel`, which the caller draws right under the sentence). */
export function PillMulti({ aria, text, open, controls, onToggle }: { aria: string; text: string; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button type="button" aria-label={aria} aria-expanded={open} aria-controls={controls} onClick={onToggle} className="jb-press write-ctl relative my-0.5 inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-md border border-[color:var(--v2-pill-edge)] bg-brand-bg py-1 pl-3.5 pr-2.5 align-middle text-[16px] font-semibold text-brand-text">
      <span className="min-w-0 truncate">{text}</span>
      <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** The ticks of a choice of several: round ticks in a quiet box. At least `min` stay on (the last one cannot be switched off). */
export function MultiPanel({ id, open, options, values, min = 1, onChange, children }: { id: string; open: boolean; options: readonly { value: string; label: string }[]; values: readonly string[]; min?: number; onChange: (next: string[]) => void; children?: ReactNode }) {
  return (
    <div id={id} hidden={!open} data-part="multi" className="rounded-xl border border-line px-3.5 py-1">
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {options.map((o) => {
          const on = values.includes(o.value);
          return <Tick key={o.value} label={o.label} checked={on} onChange={(e) => onChange(options.map((x) => x.value).filter((v) => (v === o.value ? e.target.checked : values.includes(v))))} disabled={on && values.length <= min} />;
        })}
      </div>
      {children}
    </div>
  );
}

/** "Telugu and English": names joined as the person reads them (the `and` sentence is the language's own). */
export function joinNames(and: (a: string, b: string) => string, names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(1).reduce((acc, n, i) => (i === names.length - 2 ? and(acc, n) : `${acc}, ${n}`), names[0]);
}
