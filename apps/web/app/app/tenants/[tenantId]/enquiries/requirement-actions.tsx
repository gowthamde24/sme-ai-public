"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResult } from "./action-result";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/**
 * Approve the requirement (needs a saree type and a quantity that a person approved on the same line: nothing else is required) or
 * discard it. Discarding hides behind an explicit control. Approving sends NOTHING to anyone.
 */
export function RequirementActions({
  confirm,
  discard,
  status,
  confirmable,
}: {
  confirm: Action;
  discard: Action;
  status: "draft" | "confirmed";
  confirmable: boolean;
}) {
  const [confirmState, confirmAction, confirming] = useActionState(confirm, undefined);
  const [discardState, discardAction, discarding] = useActionState(discard, undefined);
  return (
    <div>
      {status === "draft" ? (
        <form action={confirmAction}>
          <button type="submit" disabled={!confirmable || confirming || discarding}>
            {confirming ? "Saving..." : "Approve requirement"}
          </button>
          {confirmable ? null : (
            <p className="hint">Approve (or correct) a saree type and a quantity on the same line first.</p>
          )}
          <ActionResult state={confirmState} />
        </form>
      ) : null}
      <details>
        <summary className="tap">Discard this requirement</summary>
        <p className="hint">A discarded requirement can be replaced by a new suggestion run. It is kept in the history.</p>
        <form action={discardAction}>
          <button type="submit" className="secondary" disabled={confirming || discarding}>
            {discarding ? "Saving..." : "Discard"}
          </button>
          <ActionResult state={discardState} />
        </form>
      </details>
    </div>
  );
}
