import Link from "next/link";

import { CHANNEL_LABELS, type Enquiry } from "@/lib/api/enquiries";

import { LocalTime } from "../../../local-time";
import { captureEnquiryAction } from "./actions";
import { PasteEnquiryForm } from "./paste-enquiry-form";

/**
 * The "Enquiries" section of a lead page: the enquiries pasted onto this lead, and (for an owner, admin or sales user) the form to paste a
 * new one. The text of an enquiry is the customer's and is never shown here, only on the enquiry's own page as plain text.
 */
export function EnquiriesPanel({
  tenantId,
  leadId,
  enquiries,
  canWrite,
  formId,
}: {
  tenantId: string;
  leadId: string;
  /** null = the API could not be reached / returned something unexpected. */
  enquiries: Enquiry[] | null;
  canWrite: boolean;
  formId: string;
}) {
  return (
    <section aria-labelledby="enquiries-heading">
      <h2 id="enquiries-heading">Enquiries</h2>
      <p className="hint">
        Paste an e-mail or WhatsApp message from this lead to turn it into an order requirement. Nothing is sent to anyone from here.
      </p>
      {enquiries === null ? (
        <p role="alert" className="error">
          Could not load the enquiries from the API. Try again shortly.
        </p>
      ) : enquiries.length === 0 ? (
        <p>No enquiries yet.</p>
      ) : (
        <ul className="evidence-list">
          {enquiries.map((e) => (
            <li key={e.id} className="evidence-item">
              <Link href={`/app/tenants/${tenantId}/enquiries/${e.id}`} className="tap">
                {CHANNEL_LABELS[e.channel]} enquiry
              </Link>{" "}
              <span className="hint">
                received <LocalTime iso={e.received_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <details>
          <summary className="tap">Paste a new enquiry</summary>
          <PasteEnquiryForm action={captureEnquiryAction.bind(null, tenantId, leadId)} enquiryId={formId} />
        </details>
      ) : (
        <p className="hint">Only an owner, admin or sales user can paste an enquiry.</p>
      )}
    </section>
  );
}
