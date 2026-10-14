import { textIn } from "./text";
import type { FieldEntity, FieldKind, PiiClass, WorkspaceField } from "./types";

/** A field as a form draws it: already in the person's language (the form is a client component and must not carry four languages). */
export type FormField = {
  code: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  pii: PiiClass;
  choices?: readonly { code: string; label: string }[];
};

/** The active fields of one kind of record, in order, ready for a form. */
export function formFields(fields: readonly WorkspaceField[], entity: FieldEntity, lang: string): FormField[] {
  return fields
    .filter((f) => f.entity === entity && f.active)
    .map((f) => ({
      code: f.code,
      kind: f.kind,
      label: textIn(f.label, lang),
      required: f.required,
      pii: f.piiClass,
      ...(f.choices ? { choices: f.choices.map((c) => ({ code: c.code, label: textIn(c.label, lang) })) } : {}),
    }));
}
