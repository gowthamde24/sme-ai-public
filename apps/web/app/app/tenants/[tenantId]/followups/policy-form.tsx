"use client";

import Link from "next/link";

import { WEEKDAY_LABELS } from "@/lib/api/followups";

import { ActionResult } from "../enquiries/action-result";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * A cadence policy version: how long to wait between touches, how many touches at most, the quiet hours, the weekdays, the holidays, the minimum gap and the recipient's UTC offset. The OWNER
 * publishes it with the authenticator app; the database checks every rule again. The values below are a plain starting point for the owner to change: they are not the family's real policy.
 */
export function PolicyForm({ action, policyId, today, secondFactorMissing }: { action: Action; policyId: string; today: string; secondFactorMissing: boolean }) {
  const { state, formAction, pending } = useFollowupAction(action);
  if (secondFactorMissing)
    return (
      <p role="note">
        Publishing a policy needs your authenticator app. <Link href="/app/security" className="tap">Set it up on the Security page</Link>, then sign in again with its code.
      </p>
    );
  return (
    <form action={formAction} className="card" style={{ maxWidth: "36rem" }} aria-labelledby="policy-title">
      <h3 id="policy-title" style={{ margin: 0 }}>
        Publish a policy version
      </h3>
      <input type="hidden" name="policy_id" value={policyId} />
      <label htmlFor="policy-from">Starts on</label>
      <input id="policy-from" name="effective_from" type="date" defaultValue={today} min={today} required disabled={pending} />
      <label htmlFor="policy-max">Touches at most (the first message counts)</label>
      <input id="policy-max" name="max_touches" inputMode="numeric" defaultValue="3" required disabled={pending} />
      <label htmlFor="policy-gaps">Days to wait before touch 2, 3, ... (one number for each touch after the first)</label>
      <input id="policy-gaps" name="gap_days" inputMode="numeric" defaultValue="3, 7" required disabled={pending} />
      <label htmlFor="policy-qs">Quiet hours start</label>
      <input id="policy-qs" name="quiet_start" type="time" defaultValue="21:00" required disabled={pending} />
      <label htmlFor="policy-qe">Quiet hours end</label>
      <input id="policy-qe" name="quiet_end" type="time" defaultValue="09:00" required disabled={pending} />
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Weekdays a follow-up may be due</legend>
        {WEEKDAY_LABELS.map((label, i) => (
          <label key={label}>
            <input type="checkbox" name="weekday" value={String(i)} defaultChecked={i < 6} /> {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor="policy-holidays">Holidays (dates like 2026-12-25, separated by commas or lines)</label>
      <textarea id="policy-holidays" name="holidays" rows={2} disabled={pending} />
      <label htmlFor="policy-min">Minimum gap in hours</label>
      <input id="policy-min" name="min_gap_hours" inputMode="numeric" defaultValue="24" required disabled={pending} />
      <label htmlFor="policy-offset">The recipient&apos;s UTC offset in minutes (330 for India)</label>
      <input id="policy-offset" name="offset_minutes" inputMode="numeric" defaultValue="330" required disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Publish this policy"}
      </button>
      <ActionResult state={state} />
    </form>
  );
}
