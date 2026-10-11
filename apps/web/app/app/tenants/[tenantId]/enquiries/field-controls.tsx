"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, fieldInput, formInline, hintInline, summaryLine } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/**
 * Approve, reject or correct ONE field. Rendered only for an owner, admin or sales user, and only while the requirement is a draft.
 * A decided field hides the controls behind an explicit "Change" so a stray tap cannot undo an approval. A correction is written in
 * the person's own words ("30 days credit", "next Friday", "Rs 5k each") and read by the same rules as the assistant's.
 */
export function FieldControls({ decide, decided, label, words }: { decide: Action; decided: boolean; label: string; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(decide, undefined);
  const forms = (
    <>
      <form action={formAction} className={formInline}>
        <button type="submit" name="decision" value="confirm" className={btnMain} disabled={pending}>
          {t("enq.approve")}
        </button>
        <button type="submit" name="decision" value="reject" className={btnQuiet} disabled={pending}>
          {t("enq.reject")}
        </button>
      </form>
      <form action={formAction} className={formInline}>
        <input type="hidden" name="decision" value="correct" />
        <label className={hintInline} htmlFor={`correct-${label}`}>
          {t("enq.correct_to")}
        </label>
        <input id={`correct-${label}`} className={fieldInput} name="value" maxLength={120} placeholder={t("enq.write_it_as_the_enquiry_would")} disabled={pending} required />
        <button type="submit" className={btnQuiet} disabled={pending}>
          {t("enq.save_correction")}
        </button>
      </form>
    </>
  );
  return (
    <div>
      {decided ? (
        <details className={detailsBox}>
          <summary className={summaryLine}>{t("enq.change")}</summary>
          {forms}
        </details>
      ) : (
        forms
      )}
      <ActionResultV2 state={state} />
    </div>
  );
}
