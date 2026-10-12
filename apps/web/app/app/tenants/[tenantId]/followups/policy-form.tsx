"use client";

import Link from "next/link";


import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, fieldInput, fieldLabel, fieldTextarea, fieldsetPlain, formCardWide, formTitle, legendText, link } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * A cadence policy version: how long to wait between touches, how many touches at most, the quiet hours, the weekdays, the holidays, the minimum gap and the recipient's UTC offset. The OWNER
 * publishes it with the authenticator app; the database checks every rule again. The values below are a plain starting point for the owner to change: they are not the family's real policy.
 */
export function PolicyForm({ action, policyId, today, secondFactorMissing, words }: { action: Action; policyId: string; today: string; secondFactorMissing: boolean; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  if (secondFactorMissing)
    return (
      <p role="note">
        {t("fu.mfa_publishing_a_policy")} <Link href="/app/security" className={link}>{t("fu.set_it_up_on_the_security")}</Link>{t("fu.mfa_b")}
      </p>
    );
  return (
    <form action={formAction} className={formCardWide} aria-labelledby="policy-title">
      <h3 id="policy-title" className={formTitle}>
        {t("fu.publish_a_policy_version")}
      </h3>
      <input type="hidden" name="policy_id" value={policyId} />
      <label htmlFor="policy-from" className={fieldLabel}>
        {t("fu.starts_on")}
      </label>
      <input id="policy-from" name="effective_from" type="date" defaultValue={today} min={today} required disabled={pending} className={fieldInput} />
      <label htmlFor="policy-max" className={fieldLabel}>
        {t("fu.touches_at_most_the_first_message")}
      </label>
      <input id="policy-max" name="max_touches" inputMode="numeric" defaultValue="3" required disabled={pending} className={fieldInput} />
      <label htmlFor="policy-gaps" className={fieldLabel}>
        {t("fu.days_to_wait_before_touch_2")}
      </label>
      <input id="policy-gaps" name="gap_days" inputMode="numeric" defaultValue="3, 7" required disabled={pending} className={fieldInput} />
      <label htmlFor="policy-qs" className={fieldLabel}>
        {t("fu.quiet_hours_start")}
      </label>
      <input id="policy-qs" name="quiet_start" type="time" defaultValue="21:00" required disabled={pending} className={fieldInput} />
      <label htmlFor="policy-qe" className={fieldLabel}>
        {t("fu.quiet_hours_end")}
      </label>
      <input id="policy-qe" name="quiet_end" type="time" defaultValue="09:00" required disabled={pending} className={fieldInput} />
      <fieldset disabled={pending} className={fieldsetPlain}>
        <legend className={legendText}>{t("fu.weekdays_a_follow_up_may_be")}</legend>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <label key={i}>
            <input type="checkbox" name="weekday" value={String(i)} defaultChecked={i < 6} /> {t(`fu.weekday.${i}`)}
          </label>
        ))}
      </fieldset>
      <label htmlFor="policy-holidays" className={fieldLabel}>
        {t("fu.holidays_dates_like_2026_12_25")}
      </label>
      <textarea id="policy-holidays" name="holidays" rows={2} disabled={pending} className={fieldTextarea} />
      <label htmlFor="policy-min" className={fieldLabel}>
        {t("fu.minimum_gap_in_hours")}
      </label>
      <input id="policy-min" name="min_gap_hours" inputMode="numeric" defaultValue="24" required disabled={pending} className={fieldInput} />
      <label htmlFor="policy-offset" className={fieldLabel}>
        {t("fu.the_recipient_s_utc_offset_in")}
      </label>
      <input id="policy-offset" name="offset_minutes" inputMode="numeric" defaultValue="330" required disabled={pending} className={fieldInput} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("fu.saving") : t("fu.publish_this_policy")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
