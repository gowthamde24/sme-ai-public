import Link from "next/link";

import { NO_POLICY_NOTE, NOTHING_SENT, WHATSAPP_SENTENCES } from "@/lib/whatsapp/sentences";

import { alertBox, link, mutedText, noteBox, pageH4, surfaceFlat } from "@/components/v2/app/ui";

import { SentOnWhatsappForm } from "./sent-on-whatsapp-form";
import type { SentMessageState } from "./sent-on-whatsapp-actions";
import type { WhatsappView } from "./whatsapp-view";
import { makeT, type Words } from "@/components/v2/app/words";

/** `sent` is the "I sent it on WhatsApp" form: the server action already bound to this workspace and quote, and the id the page made for this render. Without it the button is not shown. */
export type SentOnWhatsapp = { action: (prev: SentMessageState, formData: FormData) => Promise<SentMessageState>; touchId: string };
type Props = { tenantId: string; quoteId: string; view: WhatsappView; sent?: SentOnWhatsapp | null; words?: Words; };

/**
 * The WhatsApp controls of an APPROVED quote, under "Copy text" (which is always there). A server component with NO number, NO text and NO link to WhatsApp in it: "Open in WhatsApp" is a link to this site's own redirect route
 * (`/app/tenants/{tenantId}/quotes/{quoteId}/whatsapp`), built from two validated ids, which reads the number on the server and redirects. It is a plain anchor, not a `Link`, so nothing prefetches it. This system sends nothing.
 *
 * What is shown, in this order: a closed-code sentence if the redirect sent the person back; then, for an expired quote, only the sentence that it expired; for a gate word, the sentence for that word (and for `consent` a link to the
 * consent page); and only if the database's own gate lets the channel through, the controls.
 */
export function WhatsappActions({ tenantId, quoteId, view, sent = null, words }: Props) {
  const t = makeT(words);
  const route = `/app/tenants/${tenantId}/quotes/${quoteId}/whatsapp`;
  return (
    <div aria-labelledby="whatsapp-heading" className={`mt-6 ${surfaceFlat}`}>
      <h4 id="whatsapp-heading" className={pageH4}>
        {t("enq.whatsapp")}
      </h4>
      {view.notice ? (
        <p role="alert" className={alertBox}>
          {WHATSAPP_SENTENCES[view.notice]}
        </p>
      ) : null}
      {view.expired ? (
        <p role="note" className={noteBox}>
          {t("enq.wa_expired", { date: view.validUntil })}
        </p>
      ) : view.gate === "unread" ? (
        <p role="note" className={mutedText}>
          {WHATSAPP_SENTENCES.unavailable}
        </p>
      ) : view.gate !== "open" ? (
        <div role="note" className={noteBox}>
          <p>{WHATSAPP_SENTENCES[view.gate]}</p>
          {view.gate === "consent" && view.consentContactId ? (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${view.consentContactId}/consent`} className={link}>
                {t("enq.record_consent_for_this_person")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {view.fits ? (
            <p>
              <a href={route} target="_blank" rel="noopener noreferrer" className={link}>
                {t("enq.open_in_whatsapp")}
              </a>
            </p>
          ) : (
            <>
              <p role="note" className={mutedText}>
                {WHATSAPP_SENTENCES.too_long}
              </p>
              <p>
                <a href={`${route}?chat=1`} target="_blank" rel="noopener noreferrer" className={link}>
                  {t("enq.open_the_whatsapp_chat")}
                </a>
              </p>
            </>
          )}
          <p className={mutedText}>{NOTHING_SENT}</p>
          {view.policyInForce === false ? (
            <p role="note" className={mutedText}>
              {NO_POLICY_NOTE}
            </p>
          ) : null}
          {sent ? <SentOnWhatsappForm words={words} action={sent.action} tenantId={tenantId} touchId={sent.touchId} consentContactId={view.consentContactId} /> : null}
        </>
      )}
    </div>
  );
}
