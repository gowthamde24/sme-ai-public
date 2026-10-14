"use client";

import type { CustomValue } from "@/lib/api/custom-fields";
import type { FormField } from "@/lib/packs/form-fields";

import { field as inputClass, label as labelClass } from "../visits/styles";

export type FieldInputWords = { title: string; yes: string; no: string; pick: string };
export type FieldValues = Readonly<Record<string, CustomValue>>;

const CHECK_CHIP = "inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:checked]:font-semibold has-[:checked]:text-brand-text has-[:disabled]:opacity-60";

/**
 * The extra fields of a business type on a form (job CL): one input for each active field, of the kind the field says (text, number, date, a choice, several choices, yes or no). Controlled: the form holds `values` and
 * is told about every change; nothing is sent from here. The labels are already in the person's language; a personal or child field carries a small mark. `idPrefix` keeps the ids of two forms on one page apart.
 */
export function CustomFieldsInputs({ fields, values, onChange, words, idPrefix, disabled = false }: { fields: readonly FormField[]; values: FieldValues; onChange: (next: FieldValues) => void; words: FieldInputWords; idPrefix: string; disabled?: boolean }) {
  if (fields.length === 0) return null;
  const set = (code: string, v: CustomValue) => onChange({ ...values, [code]: v });
  return (
    <fieldset data-part="custom-fields" className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line p-4">
      <legend className="px-1 font-display text-lg font-semibold">{words.title}</legend>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.code}`;
        const v = values[f.code];
        const name = `${f.label}${f.unit ? ` (${f.unit})` : ""}`;
        return (
          <div key={f.code} data-field={f.code}>
            {f.kind === "multi_choice" ? (
              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className={labelClass}>{name}</legend>
                <div className="flex flex-wrap gap-2">
                  {f.choices?.map((c) => {
                    const chosen = Array.isArray(v) ? (v as readonly string[]) : [];
                    return (
                      <label key={c.code} className={CHECK_CHIP}>
                        <input type="checkbox" className="size-5 shrink-0 accent-brand-text" checked={chosen.includes(c.code)} disabled={disabled} onChange={(e) => set(f.code, e.target.checked ? [...chosen, c.code] : chosen.filter((x) => x !== c.code))} />
                        {c.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : f.kind === "yes_no" ? (
              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className={labelClass}>{name}</legend>
                <div className="flex gap-2">
                  {([true, false] as const).map((b) => (
                    <label key={String(b)} className={CHECK_CHIP}>
                      <input type="radio" name={id} className="size-5 shrink-0 accent-brand-text" checked={v === b} disabled={disabled} onChange={() => set(f.code, b)} />
                      {b ? words.yes : words.no}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={id} className={labelClass}>
                  {name}
                </label>
                {f.kind === "choice" ? (
                  <select id={id} value={typeof v === "string" ? v : ""} disabled={disabled} required={f.required} onChange={(e) => set(f.code, e.target.value === "" ? null : e.target.value)} className={inputClass}>
                    <option value="">{words.pick}</option>
                    {f.choices?.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={f.kind === "date" ? "date" : "text"}
                    inputMode={f.kind === "number" ? "decimal" : undefined}
                    value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
                    maxLength={f.kind === "text" ? 100 : f.kind === "number" ? 20 : undefined}
                    required={f.required}
                    disabled={disabled}
                    autoComplete="off"
                    onChange={(e) => set(f.code, e.target.value === "" ? null : e.target.value)}
                    className={inputClass}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
