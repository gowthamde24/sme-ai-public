import type { CustomValue } from "@/lib/api/custom-fields";

import type { FieldEntity, WorkspaceField } from "./types";

/** The closed reasons a value is refused (the same words the import preview will use, ADR 0084 part 2). */
export type FieldIssue = "required" | "bad_number" | "bad_date" | "not_a_choice" | "too_long" | "bad_value";
export const MAX_TEXT = 100;

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * The values of the extra fields of a form, checked against the field definitions of the workspace (the form is untrusted): only active fields of this entity count, an unknown code is dropped, an empty
 * optional value is left out, and what is kept has the type the field says. The server (database) checks again; this keeps a wrong value from being sent and gives the person a closed reason per field.
 */
export function normaliseValues(fields: readonly WorkspaceField[], entity: FieldEntity, raw: unknown): { values: Record<string, CustomValue>; issues: Record<string, FieldIssue> } {
  const input = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const values: Record<string, CustomValue> = {};
  const issues: Record<string, FieldIssue> = {};
  for (const f of fields) {
    if (f.entity !== entity || !f.active) continue;
    const v = Object.hasOwn(input, f.code) ? input[f.code] : undefined;
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) issues[f.code] = "required";
      continue;
    }
    switch (f.kind) {
      case "text": {
        if (typeof v !== "string") issues[f.code] = "bad_value";
        else if (v.trim().length > MAX_TEXT) issues[f.code] = "too_long";
        else values[f.code] = v.trim();
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) issues[f.code] = "bad_number";
        else values[f.code] = n;
        break;
      }
      case "date": {
        if (typeof v === "string" && isDate(v.trim())) values[f.code] = v.trim();
        else issues[f.code] = "bad_date";
        break;
      }
      case "choice": {
        if (typeof v === "string" && f.choices?.some((c) => c.code === v)) values[f.code] = v;
        else issues[f.code] = "not_a_choice";
        break;
      }
      case "multi_choice": {
        if (Array.isArray(v) && v.every((x) => typeof x === "string" && f.choices?.some((c) => c.code === x))) values[f.code] = [...new Set(v as string[])];
        else issues[f.code] = "not_a_choice";
        break;
      }
      case "yes_no": {
        if (typeof v === "boolean") values[f.code] = v;
        else if (v === "yes" || v === "true") values[f.code] = true;
        else if (v === "no" || v === "false") values[f.code] = false;
        else issues[f.code] = "bad_value";
        break;
      }
    }
  }
  return { values, issues };
}
