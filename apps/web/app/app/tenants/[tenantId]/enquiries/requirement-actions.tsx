"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, formCol, mutedText, summaryLine } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/**
 * Approve the requirement (needs a saree type and a quantity that a person approved on the same line: nothing else is required) or
 * discard it. Discarding hides behind an explicit control. Approving sends NOTHING to anyone.
 */
export function RequirementActions({
  confirm,
  discard,
  status,
  confirmable, words,
}: {
  confirm: Action;
  discard: Action;
  status: "draft" | "confirmed";
  confirmable: boolean; words?: Words;
}) {
  const t = makeT(words);
  const [confirmState, confirmAction, confirming] = useActionState(confirm, undefined);
  const [discardState, discardAction, discarding] = useActionState(discard, undefined);
  return (
    <div>
      {status === "draft" ? (
        <form action={confirmAction} className={formCol}>
          <button type="submit" className={btnMain} disabled={!confirmable || confirming || discarding}>
            {confirming ? t("enq.saving") : t("enq.approve_requirement")}
          </button>
          {confirmable ? null : (
            <p className={mutedText}>{t("enq.approve_or_correct_a_saree_type")}</p>
          )}
          <ActionResultV2 state={confirmState} />
        </form>
      ) : null}
      <details className={detailsBox}>
        <summary className={summaryLine}>{t("enq.discard_this_requirement")}</summary>
        <p className={mutedText}>{t("enq.a_discarded_requirement_can_be_replaced")}</p>
        <form action={discardAction} className={formCol}>
          <button type="submit" className={btnQuiet} disabled={confirming || discarding}>
            {discarding ? t("enq.saving") : t("enq.discard")}
          </button>
          <ActionResultV2 state={discardState} />
        </form>
      </details>
    </div>
  );
}
