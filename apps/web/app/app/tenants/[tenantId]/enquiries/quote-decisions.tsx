"use client";

import Link from "next/link";
import { useActionState } from "react";

import { REJECT_CODES, REJECT_LABELS, WITHDRAW_CODES, WITHDRAW_LABELS, type Outcome } from "@/lib/api/quotes";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, detailsBox, fieldInput, fieldLabel, formStack, link, mutedText, noteBox, summaryLine } from "@/components/v2/app/ui";
import type { QuoteActionState } from "./quote-actions";

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
  secondFactorMissing,
}: {
  approve: Action;
  reject: Action;
  withdraw: Action;
  outcome: Outcome;
  role: string;
  needsOwnerApproval: boolean;
  secondFactorMissing: boolean;
}) {
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
              <p role="note" className={noteBox}>This quote carries a flag, so only the owner can approve it. You can reject it.</p>
            ) : secondFactorMissing ? (
              <p role="note" className={noteBox}>
                Approving needs your authenticator app. <Link href="/app/security" className={link}>Set it up on the Security page</Link>, then sign in again with its code.
              </p>
            ) : (
              <form action={approveAction} className={formStack}>
                <button type="submit" className={btnMain} disabled={busy}>
                  {approving ? "Approving..." : "Approve this quote"}
                </button>
                <p className={mutedText}>Approving records your decision. It does not send anything to the customer.</p>
                <ActionResultV2 state={approveState} />
              </form>
            )}
            <details className={detailsBox}>
              <summary className={summaryLine}>Reject this draft</summary>
              <form action={rejectAction} className={formStack}>
                <label htmlFor="reject-code" className={fieldLabel}>
                  Why
                </label>
                <select id="reject-code" name="code" defaultValue="wrong_prices" disabled={busy} className={fieldInput}>
                  {REJECT_CODES.map((code) => (
                    <option key={code} value={code}>
                      {REJECT_LABELS[code]}
                    </option>
                  ))}
                </select>
                <button type="submit" className={btnQuiet} disabled={busy}>
                  {rejecting ? "Saving..." : "Reject"}
                </button>
                <ActionResultV2 state={rejectState} />
              </form>
            </details>
          </>
        ) : (
          <details className={detailsBox}>
            <summary className={summaryLine}>Withdraw my draft</summary>
            <p className={mutedText}>An owner or admin approves a quote. You can withdraw a draft you made yourself.</p>
            <form action={rejectAction} className={formStack}>
              <input type="hidden" name="code" value="withdrawn" />
              <button type="submit" className={btnQuiet} disabled={busy}>
                {rejecting ? "Saving..." : "Withdraw my draft"}
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
        <summary className={summaryLine}>Withdraw this approved quote</summary>
        <p className={mutedText}>A withdrawn quote is kept in the history and can no longer be approved or copied.</p>
        {secondFactorMissing ? (
          <p role="note" className={noteBox}>
            This needs your authenticator app. <Link href="/app/security" className={link}>Set it up on the Security page</Link>, then sign in again with its code.
          </p>
        ) : (
          <form action={withdrawAction} className={formStack}>
            <label htmlFor="withdraw-code" className={fieldLabel}>
              Why
            </label>
            <select id="withdraw-code" name="code" defaultValue="price_changed" disabled={busy} className={fieldInput}>
              {WITHDRAW_CODES.map((code) => (
                <option key={code} value={code}>
                  {WITHDRAW_LABELS[code]}
                </option>
              ))}
            </select>
            <button type="submit" className={btnQuiet} disabled={busy}>
              {withdrawing ? "Saving..." : "Withdraw"}
            </button>
            <ActionResultV2 state={withdrawState} />
          </form>
        )}
      </details>
    );
  }
  return null;
}
