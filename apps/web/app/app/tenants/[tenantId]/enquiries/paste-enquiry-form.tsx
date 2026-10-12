"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import { CHANNELS } from "@/lib/api/enquiries";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, fieldInput, fieldLabel, fieldTextarea, formCardWide, mutedText } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/** "2026-10-05T14:30": the browser's local clock, the format a datetime-local input takes. */
function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const noSubscription = () => () => {};

/**
 * Paste an e-mail or a WhatsApp message onto a lead. The text is cleaned on the server BEFORE it is saved: invisible characters are
 * removed and so are e-mail addresses and mobile numbers (keep those on the contact, not in the enquiry). The original is not kept.
 * The id comes from the page (one per render), so a double click saves one enquiry. The time is the browser's local time, sent as an
 * exact instant (a hidden field), so the server never guesses a time zone.
 */
export function PasteEnquiryForm({ action, enquiryId, words }: { action: Action; enquiryId: string; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(action, undefined);
  // the browser's clock as the first value (the server snapshot is empty, so server and browser agree at first paint); the person may change it
  const initial = useSyncExternalStore(noSubscription, localNow, () => "");
  const [edited, setEdited] = useState<string | null>(null);
  const local = edited ?? initial;
  const instant = local && !Number.isNaN(new Date(local).getTime()) ? new Date(local).toISOString() : "";
  return (
    <form action={formAction} className={formCardWide}>
      <input type="hidden" name="enquiry_id" value={enquiryId} />
      <input type="hidden" name="received_at" value={instant} />
      <label htmlFor="enquiry-channel" className={fieldLabel}>
        {t("enq.where_did_it_come_from")}
      </label>
      <select id="enquiry-channel" name="channel" defaultValue="whatsapp" required disabled={pending} className={fieldInput}>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`enq.channel.${c}`)}
          </option>
        ))}
      </select>
      <label htmlFor="enquiry-received" className={fieldLabel}>
        {t("enq.when_was_it_received")}
      </label>
      <input id="enquiry-received" type="datetime-local" value={local} onChange={(e) => setEdited(e.target.value)} required disabled={pending} className={fieldInput} />
      <label htmlFor="enquiry-subject" className={fieldLabel}>
        {t("enq.subject_optional")}
      </label>
      <input id="enquiry-subject" name="subject" maxLength={2000} disabled={pending} className={fieldInput} />
      <label htmlFor="enquiry-text" className={fieldLabel}>
        {t("enq.the_enquiry_as_you_received_it")}
      </label>
      <textarea id="enquiry-text" name="text" rows={10} required disabled={pending} placeholder={t("enq.paste_the_e_mail_or_message")} className={fieldTextarea} />
      <p className={mutedText}>
        {t("enq.e_mail_addresses_and_mobile_numbers")}
      </p>
      <button type="submit" className={btnMain} disabled={pending || instant === ""}>
        {pending ? t("enq.saving") : t("enq.save_enquiry")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
