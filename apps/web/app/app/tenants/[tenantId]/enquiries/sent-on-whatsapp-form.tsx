"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { SENT_AGAIN } from "@/lib/whatsapp/sentences";

import { alertBox, btnMain, formCol, link, mutedText, okBox } from "@/components/v2/app/ui";

import { LocalTime } from "../../../local-time";
import type { SentMessageState } from "./sent-on-whatsapp-actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: SentMessageState, formData: FormData) => Promise<SentMessageState>;
type Props = { action: Action; tenantId: string; touchId: string; consentContactId: string | null; words?: Words };

/**
 * "I sent it on WhatsApp": ONE button. It records an outgoing WhatsApp touch for this quote's lead, now (the channel and the direction are fixed in the server action, not in this form). Nothing is sent from here and nothing about the
 * person (number, address) is in this component. The id comes from the page (one per render), so a second press is a retry that replays; after a SAVED press the form takes a fresh id, because another press then is a new record, and the
 * success sentence stays. The sentence under the button says what a second record means. A refusal keeps its plain sentence; a consent refusal also links to the consent page, built from ids.
 */
export function SentOnWhatsappForm({ action, tenantId, touchId, consentContactId, words }: Props) {
  return <Body words={words} key={touchId} action={action} tenantId={tenantId} touchId={touchId} consentContactId={consentContactId} />;
}

function Body({ action, tenantId, touchId, consentContactId, words }: Props) {
  const t = makeT(words);
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
      aria-label={t("enq.record_that_you_sent_this_quote")}
      className={formCol}
    >
      <input type="hidden" name="touch_id" value={id} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("orders.saving") : t("enq.i_sent_it_on_whatsapp")}
      </button>
      <p className={mutedText}>{SENT_AGAIN}</p>
      {state?.error && (
        <div role="alert" className={alertBox}>
          <p>{state.error}</p>
          {state.reason === "consent" && consentContactId && (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${consentContactId}/consent`} className={link}>
                {t("enq.record_consent_for_this_person")}
              </Link>
            </p>
          )}
        </div>
      )}
      {state?.ok && state.at && (
        <p role="status" className={okBox}>
          {t("enq.recorded_sent_wa_at")} <LocalTime iso={state.at} />. {t("enq.recorded_sent_wa_after")}
        </p>
      )}
    </form>
  );
}
