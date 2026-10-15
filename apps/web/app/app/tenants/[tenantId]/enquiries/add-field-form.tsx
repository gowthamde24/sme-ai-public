"use client";

import { useActionState, useState } from "react";

import { LINE_FIELD_KEYS, MATERIAL_FIELD_KEYS, SAREE_FIELD_KEYS, type FieldKey } from "@/lib/api/enquiries";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, fieldInput, fieldLabel, formCardWide } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/** Add a field the extraction missed. It is saved as approved (a person wrote it). A quote is optional; if given it must be words of the enquiry text. */
export function AddFieldForm({ add, words, materials = false }: { add: Action; words?: Words; materials?: boolean }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(add, undefined);
  const keys = materials ? MATERIAL_FIELD_KEYS : SAREE_FIELD_KEYS;
  const [field, setField] = useState<FieldKey>(keys[0]);
  const onLine = LINE_FIELD_KEYS.includes(field);
  return (
    <form action={formAction} className={formCardWide}>
      <label htmlFor="add-field" className={fieldLabel}>
        {t("enq.field")}
      </label>
      <select id="add-field" name="field" value={field} onChange={(e) => setField(e.target.value as FieldKey)} disabled={pending} className={fieldInput}>
        {keys.map((k) => (
          <option key={k} value={k}>
            {t(`enq.field.${k}`)}
          </option>
        ))}
      </select>
      {onLine ? (
        <>
          <label htmlFor="add-line" className={fieldLabel}>
            {t(materials ? "mat.req.line" : "enq.line_which_kind_of_saree")}
          </label>
          <select id="add-line" className={fieldInput} name="line" defaultValue="1" disabled={pending}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <label htmlFor="add-value" className={fieldLabel}>
        {t("enq.value")}
      </label>
      <input id="add-value" className={fieldInput} name="value" maxLength={120} required disabled={pending} placeholder={materials ? t(`mat.req.example.${field}` as "mat.req.example.area") : t("enq.for_example_kanchipuram_20_rs_5k")} />
      <label htmlFor="add-quote" className={fieldLabel}>
        {t("enq.words_of_the_enquiry_that_say")}
      </label>
      <input id="add-quote" className={fieldInput} name="quote" maxLength={300} disabled={pending} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("enq.adding") : t("enq.add_field")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
