import Link from "next/link";

import type { WhatsappView } from "./whatsapp-view";
import { NO_POLICY_NOTE, NOTHING_SENT, WHATSAPP_SENTENCES } from "@/lib/whatsapp/sentences";

type Props = { tenantId: string; quoteId: string; view: WhatsappView };

/**
 * The WhatsApp controls of an APPROVED quote, under "Copy text" (which is always there). A server component with NO number, NO text and NO link to WhatsApp in it: "Open in WhatsApp" is a link to this site's own redirect route
 * (`/app/tenants/{tenantId}/quotes/{quoteId}/whatsapp`), built from two validated ids, which reads the number on the server and redirects. It is a plain anchor, not a `Link`, so nothing prefetches it. This system sends nothing.
 *
 * What is shown, in this order: a closed-code sentence if the redirect sent the person back; then, for an expired quote, only the sentence that it expired; for a gate word, the sentence for that word (and for `consent` a link to the
 * consent page); and only if the database's own gate lets the channel through, the controls.
 */
export function WhatsappActions({ tenantId, quoteId, view }: Props) {
  const route = `/app/tenants/${tenantId}/quotes/${quoteId}/whatsapp`;
  return (
    <div aria-labelledby="whatsapp-heading" className="whatsapp-actions">
      <h4 id="whatsapp-heading">WhatsApp</h4>
      {view.notice ? (
        <p role="alert" className="error hint">
          {WHATSAPP_SENTENCES[view.notice]}
        </p>
      ) : null}
      {view.expired ? (
        <p role="note" className="notice">
          This quote expired after {view.validUntil}, so WhatsApp is not offered. You can still copy the text.
        </p>
      ) : view.gate === "unread" ? (
        <p role="note" className="hint">
          {WHATSAPP_SENTENCES.unavailable}
        </p>
      ) : view.gate !== "open" ? (
        <div role="note" className="notice">
          <p>{WHATSAPP_SENTENCES[view.gate]}</p>
          {view.gate === "consent" && view.consentContactId ? (
            <p>
              <Link href={`/app/tenants/${tenantId}/contacts/${view.consentContactId}/consent`} className="tap">
                Record consent for this person →
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {view.fits ? (
            <p>
              <a href={route} target="_blank" rel="noopener noreferrer" className="tap">
                Open in WhatsApp
              </a>
            </p>
          ) : (
            <>
              <p role="note" className="hint">
                {WHATSAPP_SENTENCES.too_long}
              </p>
              <p>
                <a href={`${route}?chat=1`} target="_blank" rel="noopener noreferrer" className="tap">
                  Open the WhatsApp chat
                </a>
              </p>
            </>
          )}
          <p className="hint">{NOTHING_SENT}</p>
          {view.policyInForce === false ? (
            <p role="note" className="hint">
              {NO_POLICY_NOTE}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
