"use client";

import { CHANNEL_LABELS, TOUCH_CHANNELS, type TouchChannel } from "@/lib/api/followups";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, checkBox, fieldInput, fieldLabel, fieldsetPlain, formCardWide, formTitle, legendText, mutedText, radioRow } from "@/components/v2/app/ui";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * A person records what they did OUTSIDE this system: "I sent it myself" or "they replied". The time is optional (EMPTY means now) and never in the future (the field's `max` is the page's
 * own India time; the database refuses a future time anyway). The channel starts on the tab's channel (a person may choose another, or a phone call). This form sends nothing to anyone: it keeps a record.
 */
export function TouchForm({ action, touchId, maxNow, channel = "email" }: { action: Action; touchId: string; maxNow: string; channel?: TouchChannel }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} className={formCardWide} aria-labelledby="touch-title">
      <h3 id="touch-title" className={formTitle}>
        Record a touch
      </h3>
      <p className={mutedText}>This keeps a record of something that already happened outside this system. Nothing is sent.</p>
      <input type="hidden" name="touch_id" value={touchId} />
      <fieldset disabled={pending} className={fieldsetPlain}>
        <legend className={legendText}>What happened</legend>
        <label className={radioRow}>
          <input type="radio" name="direction" value="out" defaultChecked className={checkBox} /> I sent it myself
        </label>
        <label className={radioRow}>
          <input type="radio" name="direction" value="in" className={checkBox} /> They replied
        </label>
      </fieldset>
      <label htmlFor="touch-channel" className={fieldLabel}>
        Channel
      </label>
      <select id="touch-channel" name="channel" defaultValue={channel} disabled={pending} className={fieldInput}>
        {TOUCH_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <label htmlFor="touch-when" className={fieldLabel}>
        When (India time). Leave it empty for now.
      </label>
      <input id="touch-when" name="happened_at" type="datetime-local" max={maxNow} disabled={pending} className={fieldInput} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Saving..." : "Record this"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
