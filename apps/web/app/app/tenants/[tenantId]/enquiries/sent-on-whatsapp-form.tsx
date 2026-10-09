"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { SENT_AGAIN } from "@/lib/whatsapp/sentences";

import { alertBox, btnMain, formCol, link, mutedText, okBox } from "@/components/v2/app/ui";

import { LocalTime } from "../../../local-time";
import type { SentMessageState } from "./sent-on-whatsapp-actions";

type Action = (prev: SentMessageState, formData: FormData) => Promise<SentMessageState>;
type Props = { action: Action; tenantId: string; touchId: string; consentContactId: string | null };

/**
 * "I sent it on WhatsApp": ONE button. It records an outgoing WhatsApp touch for this quote's lead, now (the channel and the direction are fixed in the server action, not in this form). Nothing is sent from here and nothing about the
 * person (number, address) is in this component. The id comes from the page (one per render), so a second press is a retry that replays; after a SAVED press the form takes a fresh id, because another press then is a new record, and the
 * success sentence stays. The sentence under the button says what a second record means. A refusal keeps its plain sentence; a consent refusal also links to the consent page, built from ids.
 */
export function SentOnWhatsappForm({ action, tenantId, touchId, consentContactId }: Props) {
  return <Body key={touchId} action={action} tenantId={tenantId} touchId={touchId} consentContactId={consentContactId} />;
}

function Body({ action, tenantId, touchId, consentContactId }: Props) {
  const [id, setId] = useState(touchId);
  const [state, formAction, pending] = useActionState(async (prev: SentMessageState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.ok) setId(crypto.randomUUID());
    return next;
  }, undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      aria-label="Record that you sent this quote on WhatsApp"
      className={formCol}
    >
      <input type="hidden" name="touch_id" value={id} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Saving..." : "I sent it on WhatsApp"}
      </button>
      <p className={mutedText}>{SENT_AGAIN}</p>
      {state?.error && (
        <div role="alert" className={alertBox}>
          <p>{state.error}</p>
          {state.reason === "consent" && consentContactId && (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${consentContactId}/consent`} className={link}>
                Record consent for this person →
              </Link>
            </p>
          )}
        </div>
      )}
      {state?.ok && state.at && (
        <p role="status" className={okBox}>
          Recorded: you sent this quote on WhatsApp at <LocalTime iso={state.at} />. The follow-up list will show this lead when it is due.
        </p>
      )}
    </form>
  );
}
