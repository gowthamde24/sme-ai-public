"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, formCol, mutedText, summaryLine } from "@/components/v2/app/ui";

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
        <form action={confirmAction} className={formCol}>
          <button type="submit" className={btnMain} disabled={!confirmable || confirming || discarding}>
            {confirming ? "Saving..." : "Approve requirement"}
          </button>
          {confirmable ? null : (
            <p className={mutedText}>Approve (or correct) a saree type and a quantity on the same line first.</p>
          )}
          <ActionResultV2 state={confirmState} />
        </form>
      ) : null}
      <details className={detailsBox}>
        <summary className={summaryLine}>Discard this requirement</summary>
        <p className={mutedText}>A discarded requirement can be replaced by a new suggestion run. It is kept in the history.</p>
        <form action={discardAction} className={formCol}>
          <button type="submit" className={btnQuiet} disabled={confirming || discarding}>
            {discarding ? "Saving..." : "Discard"}
          </button>
          <ActionResultV2 state={discardState} />
        </form>
      </details>
    </div>
  );
}
