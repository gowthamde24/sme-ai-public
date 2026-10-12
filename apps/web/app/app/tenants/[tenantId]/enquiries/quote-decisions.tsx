"use client";

import Link from "next/link";
import { useActionState } from "react";

import { REJECT_CODES, WITHDRAW_CODES, type Outcome } from "@/lib/api/quotes";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, fieldInput, fieldLabel, formStack, link, mutedText, noteBox, summaryLine } from "@/components/v2/app/ui";
import type { QuoteActionState } from "./quote-actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

/**
 * What a person may do with this quote, and why not when they may not. Approving and withdrawing are for an owner or an admin who has used their
 * authenticator app; a quote that carries a flag is the owner's alone. The database enforces every one of these again. Approving sends NOTHING.
 */
export function QuoteDecisions({
  approve,
  reject,
  withdraw,
  outcome,
  role,
  needsOwnerApproval,
  secondFactorMissing, words,
}: {
  approve: Action;
  reject: Action;
  withdraw: Action;
  outcome: Outcome;
  role: string;
  needsOwnerApproval: boolean;
  secondFactorMissing: boolean; words?: Words;
}) {
  const t = makeT(words);
  const [approveState, approveAction, approving] = useActionState(approve, undefined);
  const [rejectState, rejectAction, rejecting] = useActionState(reject, undefined);
  const [withdrawState, withdrawAction, withdrawing] = useActionState(withdraw, undefined);
  const decider = role === "owner" || role === "admin";
  const busy = approving || rejecting || withdrawing;

  if (outcome === "draft") {
    const adminBlocked = role === "admin" && needsOwnerApproval;
    return (
      <div>
        {decider ? (
          <>
            {adminBlocked ? (
              <p role="note" className={noteBox}>{t("enq.this_quote_carries_a_flag_so")}</p>
            ) : secondFactorMissing ? (
              <p role="note" className={noteBox}>
                {t("enq.approve_mfa_a")} <Link href="/app/security" className={link}>{t("enq.set_it_up_on_the_security")}</Link>{t("enq.mfa_b")}
              </p>
            ) : (
              <form action={approveAction} className={formStack}>
                <button type="submit" className={btnMain} disabled={busy}>
                  {approving ? t("enq.approving") : t("enq.approve_this_quote")}
                </button>
                <p className={mutedText}>{t("enq.approving_records_your_decision_it_does")}</p>
                <ActionResultV2 state={approveState} />
              </form>
            )}
            <details className={detailsBox}>
              <summary className={summaryLine}>{t("enq.reject_this_draft")}</summary>
              <form action={rejectAction} className={formStack}>
                <label htmlFor="reject-code" className={fieldLabel}>
                  {t("enq.why")}
                </label>
                <select id="reject-code" name="code" defaultValue="wrong_prices" disabled={busy} className={fieldInput}>
                  {REJECT_CODES.map((code) => (
                    <option key={code} value={code}>
                      {t(`enq.reject.${code}`)}
                    </option>
                  ))}
                </select>
                <button type="submit" className={btnQuiet} disabled={busy}>
                  {rejecting ? t("enq.saving") : t("enq.reject")}
                </button>
                <ActionResultV2 state={rejectState} />
              </form>
            </details>
          </>
        ) : (
          <details className={detailsBox}>
            <summary className={summaryLine}>{t("enq.withdraw_my_draft")}</summary>
            <p className={mutedText}>{t("enq.an_owner_or_admin_approves_a")}</p>
            <form action={rejectAction} className={formStack}>
              <input type="hidden" name="code" value="withdrawn" />
              <button type="submit" className={btnQuiet} disabled={busy}>
                {rejecting ? t("enq.saving") : t("enq.withdraw_my_draft")}
              </button>
              <ActionResultV2 state={rejectState} />
            </form>
          </details>
        )}
      </div>
    );
  }
  if (outcome === "approved" && decider) {
    return (
      <details className={detailsBox}>
        <summary className={summaryLine}>{t("enq.withdraw_this_approved_quote")}</summary>
        <p className={mutedText}>{t("enq.a_withdrawn_quote_is_kept_in")}</p>
        {secondFactorMissing ? (
          <p role="note" className={noteBox}>
            {t("enq.mfa_a")} <Link href="/app/security" className={link}>{t("enq.set_it_up_on_the_security")}</Link>{t("enq.mfa_b")}
          </p>
        ) : (
          <form action={withdrawAction} className={formStack}>
            <label htmlFor="withdraw-code" className={fieldLabel}>
              {t("enq.why")}
            </label>
            <select id="withdraw-code" name="code" defaultValue="price_changed" disabled={busy} className={fieldInput}>
              {WITHDRAW_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`enq.withdraw.${code}`)}
                </option>
              ))}
            </select>
            <button type="submit" className={btnQuiet} disabled={busy}>
              {withdrawing ? t("enq.saving") : t("enq.withdraw")}
            </button>
            <ActionResultV2 state={withdrawState} />
          </form>
        )}
      </details>
    );
  }
  return null;
}
