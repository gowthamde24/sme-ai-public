"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResult } from "./action-result";

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
      <form action={formAction} className="review-actions" style={{ border: 0, paddingTop: 0 }}>
        <button type="submit" name="decision" value="confirm" disabled={pending}>
          Approve
        </button>
        <button type="submit" name="decision" value="reject" className="secondary" disabled={pending}>
          Reject
        </button>
      </form>
      <form action={formAction} className="review-actions" style={{ border: 0, paddingTop: 0 }}>
        <input type="hidden" name="decision" value="correct" />
        <label className="hint" htmlFor={`correct-${label}`}>
          Correct to
        </label>
        <input id={`correct-${label}`} name="value" maxLength={120} placeholder="Write it as the enquiry would" disabled={pending} required />
        <button type="submit" className="secondary" disabled={pending}>
          Save correction
        </button>
      </form>
    </>
  );
  return (
    <div>
      {decided ? (
        <details>
          <summary className="tap">Change</summary>
          {forms}
        </details>
      ) : (
        forms
      )}
      <ActionResult state={state} />
    </div>
  );
}
