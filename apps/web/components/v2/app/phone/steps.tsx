import { Check } from "lucide-react";
import type * as React from "react";

/**
 * The numbered steps of the phone pages (mock "Get a phone number" and "Verify your business"): a hairline above each, a round number (the step in hand is ink, a finished one a tick), the title, and, for the step in hand only, its body. Open layout: no card per step.
 * `now` = in hand, `done` = finished, `off` = waiting. A finished step may show one short summary line (`summary`).
 */
export type StepState = "now" | "done" | "off";
export function Step({ n, title, state, summary, children }: { n: number; title: string; state: StepState; summary?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li data-step={n} data-state-of={state} className="flex gap-4 border-b border-line py-5 first:pt-0 last:border-b-0 last:pb-0">
      <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full border text-sm font-bold ${state === "now" ? "border-ink bg-ink text-surface" : state === "done" ? "border-ink text-ink" : "border-line text-muted"}`}>
        {state === "done" ? <Check className="size-4" strokeWidth={2.4} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={`m-0 text-[18px] leading-snug ${state === "off" ? "font-semibold text-muted" : "font-bold text-ink"}`}>
          {title}
          {state === "done" ? <span className="sr-only"> ✓</span> : null}
        </h2>
        {summary ? <p className="m-0 mt-1 text-[15px] text-muted">{summary}</p> : null}
        {children}
      </div>
    </li>
  );
}

/** Two choices as one segmented control (Mobile | Landline, Individual | Business): real buttons, the chosen one pressed. */
export function Seg<T extends string>({ label, value, options, onChange, disabled = false }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full rounded-full border border-line bg-surface p-1">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} aria-pressed={value === o.value} data-seg={o.value} onClick={() => onChange(o.value)} className={`min-h-11 min-w-0 rounded-full px-5 text-[15px] font-semibold ${value === o.value ? "bg-ink text-surface" : "text-muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A neutral line: a dot and one sentence (the app's notice). `warn` = the dot is the one orange of the page (something waits for the owner). */
export function Notice({ children, warn = false, part }: { children: React.ReactNode; warn?: boolean; part?: string }) {
  return (
    <p data-part={part} className={`m-0 flex items-start gap-3 border-y border-line py-4 text-[15px] ${warn ? "font-semibold text-ink" : "text-muted"}`}>
      <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${warn ? "bg-brand-text" : "bg-muted"}`} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
