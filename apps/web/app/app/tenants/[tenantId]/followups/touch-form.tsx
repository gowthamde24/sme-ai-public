"use client";

import { CHANNEL_LABELS, TOUCH_CHANNELS, type TouchChannel } from "@/lib/api/followups";

import { ActionResult } from "../enquiries/action-result";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * A person records what they did OUTSIDE this system: "I sent it myself" or "they replied". The time is optional (EMPTY means now) and never in the future (the field's `max` is the page's
 * own India time; the database refuses a future time anyway). The channel starts on the tab's channel (a person may choose another, or a phone call). This form sends nothing to anyone: it keeps a record.
 */
export function TouchForm({ action, touchId, maxNow, channel = "email" }: { action: Action; touchId: string; maxNow: string; channel?: TouchChannel }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} className="card" style={{ maxWidth: "36rem" }} aria-labelledby="touch-title">
      <h3 id="touch-title" style={{ margin: 0 }}>
        Record a touch
      </h3>
      <p className="hint">This keeps a record of something that already happened outside this system. Nothing is sent.</p>
      <input type="hidden" name="touch_id" value={touchId} />
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>What happened</legend>
        <label>
          <input type="radio" name="direction" value="out" defaultChecked /> I sent it myself
        </label>
        <label>
          <input type="radio" name="direction" value="in" /> They replied
        </label>
      </fieldset>
      <label htmlFor="touch-channel">Channel</label>
      <select id="touch-channel" name="channel" defaultValue={channel} disabled={pending}>
        {TOUCH_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <label htmlFor="touch-when">When (India time). Leave it empty for now.</label>
      <input id="touch-when" name="happened_at" type="datetime-local" max={maxNow} disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Record this"}
      </button>
      <ActionResult state={state} />
    </form>
  );
}
