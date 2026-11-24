"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { Tick } from "../../ds/Tick";

/**
 * The plain fields of the Settings pages (owner, 25 Nov 2026: no more sentences with a blank in them): a label ABOVE the field, the field, ONE grey hint line under it. Used by Settings and Team (SETTINGS_OPEN);
 * the same parts will serve every form that leaves the sentence style (reports/sentence-filters-audit.md). No box, no pill, no tint; an orange edge only on focus.
 */
export const fieldCls = "min-h-11 w-full rounded-lg border border-edge bg-transparent px-3 text-[16px] text-ink placeholder:text-muted focus:border-brand-edge disabled:opacity-60";

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string | null; children: ReactNode }) {
  return (
    <div data-field="" className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 text-[14px] text-muted">{hint}</p> : null}
    </div>
  );
}

type TextProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id"> & { label: string; hint?: string | null; value: string; onChange: (v: string) => void };
export function TextField({ label, hint, value, onChange, ...input }: TextProps) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint}>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className={fieldCls} {...input} />
    </Field>
  );
}

export function SelectField({ label, hint, value, options, onChange, disabled = false, name, invalid = false }: { /** the API refused this value the last time: marked */ invalid?: boolean; label: string; hint?: string | null; value: string; options: readonly { value: string; label: string; disabled?: boolean }[]; onChange: (v: string) => void; disabled?: boolean; name?: string }) {
  const id = useId();
  const list = options.some((o) => o.value === value) ? options : [{ value, label: value }, ...options];
  return (
    <Field id={id} label={label} hint={hint}>
      <select id={id} name={name} value={value} disabled={disabled} aria-invalid={invalid ? true : undefined} onChange={(e) => onChange(e.target.value)} className={`${fieldCls} aria-[invalid=true]:border-red-text`}>
        {list.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Several of a few (languages): round ticks in two columns, no box; the last tick cannot be switched off. */
export function TickGroup({ legend, hint, options, values, onChange, disabled = false }: { legend: string; hint?: string | null; options: readonly { value: string; label: string }[]; values: readonly string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <fieldset data-field="" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="p-0 text-[15px] font-semibold text-ink">{legend}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <Tick
              key={o.value}
              label={o.label}
              checked={on}
              disabled={disabled}
              onChange={(e) => {
                const next = options.map((x) => x.value).filter((v) => (v === o.value ? e.target.checked : values.includes(v)));
                if (next.length > 0) onChange(next);
              }}
            />
          );
        })}
      </div>
      {hint ? <p className="m-0 text-[14px] text-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** The one Save of a page: disabled until something changed; the line beside it says "You have unsaved changes." and then "Saved." (never a chip). */
export function SaveBar({ dirty, saved, pending, label, unsaved, done, onClass }: { dirty: boolean; saved: boolean; pending: boolean; label: string; unsaved: string; done: string; onClass: string }) {
  return (
    <div data-part="save" className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending || !dirty} className={onClass}>
        {label}
      </button>
      <p role="status" className="m-0 text-[14px] text-muted">
        {dirty ? unsaved : saved ? done : ""}
      </p>
    </div>
  );
}
