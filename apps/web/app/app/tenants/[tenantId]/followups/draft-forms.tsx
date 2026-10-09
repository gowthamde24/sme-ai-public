"use client";

import Link from "next/link";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, btnQuiet, fieldInput, link } from "@/components/v2/app/ui";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * Approve the draft the person is LOOKING AT: the form carries the draft's fingerprint as it was rendered (`state_hash`), so a draft that changed since is refused as stale and the page is read
 * again. Approving does not send anything: it lets a person copy the text and send it themselves. When the session has not used the authenticator app the form is replaced by the notice.
 */
export function ApproveForm({ action, stateHash, secondFactorMissing }: { action: Action; stateHash: string; secondFactorMissing: boolean }) {
  const { state, formAction, pending } = useFollowupAction(action);
  if (secondFactorMissing)
    return (
      <p role="note">
        Approving needs your authenticator app. <Link href="/app/security" className={link}>Set it up on the Security page</Link>, then sign in again with its code.
      </p>
    );
  return (
    <form action={formAction} aria-label="Approve this draft">
      <input type="hidden" name="state_hash" value={stateHash} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Saving..." : "Approve this text"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

export function DiscardForm({ action }: { action: Action }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label="Discard this draft">
      <button type="submit" className={btnQuiet} disabled={pending}>
        {pending ? "Saving..." : "Discard this draft"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

/** "I sent it myself": a person's word, recorded. The time is optional (empty means now; never in the future). The system sent nothing. */
export function SentForm({ action, touchId, maxNow }: { action: Action; touchId: string; maxNow: string }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label="Record that you sent it yourself">
      <input type="hidden" name="touch_id" value={touchId} />
      <label htmlFor={`sent-when-${touchId}`}>When you sent it (India time). Leave it empty for now.</label>
      <input id={`sent-when-${touchId}`} name="happened_at" type="datetime-local" max={maxNow} disabled={pending} className={fieldInput} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Saving..." : "Record: I sent it myself"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
