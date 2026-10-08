"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { CHANNEL_LABELS, TOUCH_CHANNELS } from "@/lib/api/followups";

import { LocalTime } from "../../../../local-time";
import type { SentMessageState } from "./sent-message-actions";

type Action = (prev: SentMessageState, formData: FormData) => Promise<SentMessageState>;

/**
 * "I sent a message": records an OUTGOING touch, a message the person sent themselves outside this system. Nothing is sent from here and nothing about the person (number or e-mail) is shown.
 *
 * The channel has NO default and is required; the time is optional (empty means now) and never later than the page's own India time. The id comes from the page (one per render), so a second
 * press is a retry. The body is keyed on that id: a new id from the page restarts the form (empty fields, the new id). After a SAVED message the form gets a fresh id and empties its fields (a later
 * message is a new record, not a replay) and the success sentence stays until the next press. Held in state and submitted through onSubmit, so a refusal keeps what the person chose.
 */
type Props = { action: Action; tenantId: string; touchId: string; maxNow: string; contactId: string | null };

export function SentMessageForm({ action, tenantId, touchId, maxNow, contactId }: Props) {
  return <SentMessageBody key={touchId} action={action} tenantId={tenantId} touchId={touchId} maxNow={maxNow} contactId={contactId} />;
}

function SentMessageBody({ action, tenantId, touchId, maxNow, contactId }: Props) {
  const [id, setId] = useState(touchId);
  const [channel, setChannel] = useState("");
  const [when, setWhen] = useState("");
  const [state, formAction, pending] = useActionState(async (prev: SentMessageState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.ok) {
      setId(crypto.randomUUID());
      setChannel("");
      setWhen("");
    }
    return next;
  }, undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="card"
      style={{ maxWidth: "36rem" }}
      aria-labelledby="sent-title"
    >
      <h3 id="sent-title" style={{ margin: 0 }}>
        I sent a message
      </h3>
      <p className="hint">This keeps a record of a message you sent yourself, outside this system. Nothing is sent from here.</p>
      <input type="hidden" name="touch_id" value={id} />
      <label htmlFor="sent-channel">Channel</label>
      <select id="sent-channel" name="channel" required value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending}>
        <option value="" disabled>
          Choose one
        </option>
        {TOUCH_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <label htmlFor="sent-when">When (India time). Leave it empty for now.</label>
      <input id="sent-when" name="happened_at" type="datetime-local" max={maxNow} value={when} onChange={(e) => setWhen(e.target.value)} disabled={pending} />
      {state?.error && (
        <div role="alert" className="error hint">
          <p>{state.error}</p>
          {state.reason === "consent" && contactId && (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${contactId}/consent`} className="tap">
                Record consent for this person →
              </Link>
            </p>
          )}
        </div>
      )}
      {state?.ok && state.channel && state.at && (
        <p role="status" className="hint">
          Recorded: you sent a message by {CHANNEL_LABELS[state.channel]} at <LocalTime iso={state.at} />. The follow-up list will show this lead when it is due.
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Record this"}
      </button>
    </form>
  );
}
