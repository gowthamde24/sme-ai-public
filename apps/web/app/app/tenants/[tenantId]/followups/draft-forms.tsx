"use client";

import Link from "next/link";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, btnQuiet, fieldInput, link } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * Approve the draft the person is LOOKING AT: the form carries the draft's fingerprint as it was rendered (`state_hash`), so a draft that changed since is refused as stale and the page is read
 * again. Approving does not send anything: it lets a person copy the text and send it themselves. When the session has not used the authenticator app the form is replaced by the notice.
 */
export function ApproveForm({ action, stateHash, secondFactorMissing, words }: { action: Action; stateHash: string; secondFactorMissing: boolean; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  if (secondFactorMissing)
    return (
      <p role="note">
        {t("fu.mfa_approving")} <Link href="/app/security" className={link}>{t("fu.set_it_up_on_the_security")}</Link>{t("fu.mfa_b")}
      </p>
    );
  return (
    <form action={formAction} aria-label={t("fu.approve_this_draft")}>
      <input type="hidden" name="state_hash" value={stateHash} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("fu.saving") : t("fu.approve_this_text")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

export function DiscardForm({ action, words }: { action: Action; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label={t("fu.discard_this_draft")}>
      <button type="submit" className={btnQuiet} disabled={pending}>
        {pending ? t("fu.saving") : t("fu.discard_this_draft")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

/** "I sent it myself": a person's word, recorded. The time is optional (empty means now; never in the future). The system sent nothing. */
export function SentForm({ action, touchId, maxNow, words }: { action: Action; touchId: string; maxNow: string; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label={t("fu.record_that_you_sent_it_yourself")}>
      <input type="hidden" name="touch_id" value={touchId} />
      <label htmlFor={`sent-when-${touchId}`}>{t("fu.when_you_sent_it_india_time")}</label>
      <input id={`sent-when-${touchId}`} name="happened_at" type="datetime-local" max={maxNow} disabled={pending} className={fieldInput} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("fu.saving") : t("fu.record_i_sent_it_myself")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
