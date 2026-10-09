"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, fieldInput, formInline, hintInline, summaryLine } from "@/components/v2/app/ui";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/**
 * Approve, reject or correct ONE field. Rendered only for an owner, admin or sales user, and only while the requirement is a draft.
 * A decided field hides the controls behind an explicit "Change" so a stray tap cannot undo an approval. A correction is written in
 * the person's own words ("30 days credit", "next Friday", "Rs 5k each") and read by the same rules as the assistant's.
 */
export function FieldControls({ decide, decided, label }: { decide: Action; decided: boolean; label: string }) {
  const [state, formAction, pending] = useActionState(decide, undefined);
  const forms = (
    <>
      <form action={formAction} className={formInline}>
        <button type="submit" name="decision" value="confirm" className={btnMain} disabled={pending}>
          Approve
        </button>
        <button type="submit" name="decision" value="reject" className={btnQuiet} disabled={pending}>
          Reject
        </button>
      </form>
      <form action={formAction} className={formInline}>
        <input type="hidden" name="decision" value="correct" />
        <label className={hintInline} htmlFor={`correct-${label}`}>
          Correct to
        </label>
        <input id={`correct-${label}`} className={fieldInput} name="value" maxLength={120} placeholder="Write it as the enquiry would" disabled={pending} required />
        <button type="submit" className={btnQuiet} disabled={pending}>
          Save correction
        </button>
      </form>
    </>
  );
  return (
    <div>
      {decided ? (
        <details className={detailsBox}>
          <summary className={summaryLine}>Change</summary>
          {forms}
        </details>
      ) : (
        forms
      )}
      <ActionResultV2 state={state} />
    </div>
  );
}
