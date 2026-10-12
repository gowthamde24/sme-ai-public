"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { TOUCH_CHANNELS } from "@/lib/api/followups";

import { LocalTime } from "../../../../local-time";
import type { SentMessageState } from "./sent-message-actions";
import { alertBox, btnMain, fieldInput, fieldLabel, formCardWide, formTitle, link, mutedText, okBox } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: SentMessageState, formData: FormData) => Promise<SentMessageState>;

/**
 * "I sent a message": records an OUTGOING touch, a message the person sent themselves outside this system. Nothing is sent from here and nothing about the person (number or e-mail) is shown.
 *
 * The channel has NO default and is required; the time is optional (empty means now) and never later than the page's own India time. The id comes from the page (one per render), so a second
 * press is a retry. The body is keyed on that id: a new id from the page restarts the form (empty fields, the new id). After a SAVED message the form gets a fresh id and empties its fields (a later
 * message is a new record, not a replay) and the success sentence stays until the next press. Held in state and submitted through onSubmit, so a refusal keeps what the person chose.
 */
type Props = { action: Action; tenantId: string; touchId: string; maxNow: string; contactId: string | null; words?: Words };

export function SentMessageForm({ action, tenantId, touchId, maxNow, contactId, words }: Props) {
  return <SentMessageBody words={words} key={touchId} action={action} tenantId={tenantId} touchId={touchId} maxNow={maxNow} contactId={contactId} />;
}

function SentMessageBody({ action, tenantId, touchId, maxNow, contactId, words }: Props) {
  const t = makeT(words);
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
      className={formCardWide}
      aria-labelledby="sent-title"
    >
      <h3 id="sent-title" className={formTitle}>
        {t("lead.i_sent_a_message")}
      </h3>
      <p className={mutedText}>{t("lead.this_keeps_a_record_of_a")}</p>
      <input type="hidden" name="touch_id" value={id} />
      <label htmlFor="sent-channel" className={fieldLabel}>
        {t("lead.channel")}
      </label>
      <select id="sent-channel" name="channel" required value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending} className={fieldInput}>
        <option value="" disabled>
          {t("lead.choose_one")}
        </option>
        {TOUCH_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`fu.channel.${c}`)}
          </option>
        ))}
      </select>
      <label htmlFor="sent-when" className={fieldLabel}>
        {t("lead.when_india_time_leave_it_empty")}
      </label>
      <input id="sent-when" name="happened_at" type="datetime-local" max={maxNow} value={when} onChange={(e) => setWhen(e.target.value)} disabled={pending} className={fieldInput} />
      {state?.error && (
        <div role="alert" className={alertBox}>
          <p>{state.error}</p>
          {state.reason === "consent" && contactId && (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${contactId}/consent`} className={link}>
                {t("lead.record_consent_for_this_person")}
              </Link>
            </p>
          )}
        </div>
      )}
      {state?.ok && state.channel && state.at && (
        <p role="status" className={okBox}>
          <Rich t={t} k="lead.sent_recorded" vars={{ channel: t(`fu.channel.${state.channel}`) }} with={{ time: <LocalTime iso={state.at} /> }} />
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("lead.saving") : t("lead.record_this")}
      </button>
    </form>
  );
}
