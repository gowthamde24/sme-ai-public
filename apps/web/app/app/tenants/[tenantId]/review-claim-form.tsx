"use client";

import { useActionState } from "react";

import {
  CONFIDENCE_LABELS,
  REVIEW_CONFIDENCES,
  REVIEW_REASON_LABELS,
  REVIEW_REASONS,
} from "@/lib/api/agents";

import type { ReviewActionState } from "./suggestion-actions";
import { alertBox, btnMain, btnQuiet, formsStack, hintInline, inlineForm, okBox, selectInline } from "@/components/v2/app/ui";

type Action = (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

function Result({ state }: { state: ReviewActionState }) {
  if (state?.error)
    return (
      <p role="alert" className={alertBox}>
        {state.error}
      </p>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className={okBox}>
        {state.message}
      </p>
    );
  return null;
}

/**
 * Accept (low / medium / high, chosen by the person) or reject (a reason is optional) ONE agent suggestion. Rendered only for an
 * owner or admin. NOTHING is preselected: a stray tap cannot approve (or downgrade an approval) by accident. The page gives each of the two buttons its own review id, generated once per render: a retry or a double
 * click re-sends the same id and is one review.
 */
export function ReviewClaimForms({
  claimId,
  acceptId,
  rejectId,
  accept,
  reject,
}: {
  claimId: string;
  acceptId: string;
  rejectId: string;
  accept: Action;
  reject: Action;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(accept, undefined);
  const [rejectState, rejectAction, rejecting] = useActionState(reject, undefined);
  return (
    <div className={formsStack}>
      <form action={acceptAction} className={inlineForm}>
        <input type="hidden" name="review_id" value={acceptId} />
        <input type="hidden" name="decision" value="accepted" />
        <label htmlFor={`confidence-${claimId}`} className={hintInline}>
          Accept as
        </label>{" "}
        <select id={`confidence-${claimId}`} name="confidence" defaultValue="" required disabled={accepting} className={selectInline}>
          <option value="" disabled>
            Choose…
          </option>
          {REVIEW_CONFIDENCES.map((c) => (
            <option key={c} value={c}>
              {CONFIDENCE_LABELS[c]}
            </option>
          ))}
        </select>{" "}
        <button type="submit" className={btnMain} disabled={accepting || rejecting}>
          {accepting ? "Saving..." : "Accept"}
        </button>
        <Result state={acceptState} />
      </form>
      <form action={rejectAction} className={inlineForm}>
        <input type="hidden" name="review_id" value={rejectId} />
        <input type="hidden" name="decision" value="rejected" />
        <label htmlFor={`reason-${claimId}`} className={hintInline}>
          Reject (a reason is optional)
        </label>{" "}
        <select id={`reason-${claimId}`} name="reason_code" defaultValue="" disabled={rejecting} className={selectInline}>
          <option value="">No reason</option>
          {REVIEW_REASONS.map((r) => (
            <option key={r} value={r}>
              {REVIEW_REASON_LABELS[r]}
            </option>
          ))}
        </select>{" "}
        <button type="submit" className={btnQuiet} disabled={accepting || rejecting}>
          {rejecting ? "Saving..." : "Reject"}
        </button>
        <Result state={rejectState} />
      </form>
    </div>
  );
}
