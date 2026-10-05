"use client";

import { useActionState, useState } from "react";

import { FIELD_KEYS, FIELD_LABELS, LINE_FIELD_KEYS, type FieldKey } from "@/lib/api/enquiries";

import type { EnquiryActionState } from "./actions";
import { ActionResult } from "./action-result";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/** Add a field the extraction missed. It is saved as approved (a person wrote it). A quote is optional; if given it must be words of the enquiry text. */
export function AddFieldForm({ add }: { add: Action }) {
  const [state, formAction, pending] = useActionState(add, undefined);
  const [field, setField] = useState<FieldKey>("saree_type");
  const onLine = LINE_FIELD_KEYS.includes(field);
  return (
    <form action={formAction} className="card" style={{ maxWidth: "36rem" }}>
      <label htmlFor="add-field">Field</label>
      <select id="add-field" name="field" value={field} onChange={(e) => setField(e.target.value as FieldKey)} disabled={pending}>
        {FIELD_KEYS.map((k) => (
          <option key={k} value={k}>
            {FIELD_LABELS[k]}
          </option>
        ))}
      </select>
      {onLine ? (
        <>
          <label htmlFor="add-line">Line (which kind of saree)</label>
          <select id="add-line" name="line" defaultValue="1" disabled={pending}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <label htmlFor="add-value">Value</label>
      <input id="add-value" name="value" maxLength={120} required disabled={pending} placeholder="For example: Kanchipuram, 20, Rs 5k each, next Friday" />
      <label htmlFor="add-quote">Words of the enquiry that say it (optional)</label>
      <input id="add-quote" name="quote" maxLength={300} disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add field"}
      </button>
      <ActionResult state={state} />
    </form>
  );
}
