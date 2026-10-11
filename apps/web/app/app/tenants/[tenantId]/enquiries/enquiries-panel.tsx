import Link from "next/link";

import { type Enquiry } from "@/lib/api/enquiries";

import { LocalTime } from "../../../local-time";
import { captureEnquiryAction } from "./actions";
import { PasteEnquiryForm } from "./paste-enquiry-form";
import { AddButton } from "@/components/v2/app/AddButton";
import { alertBox, hintInline, link, listItemCard, listPlain, mutedText, pageH2 } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

/**
 * The "Enquiries" section of a lead page: the enquiries pasted onto this lead, and (for an owner, admin or sales user) the form to paste a
 * new one. The text of an enquiry is the customer's and is never shown here, only on the enquiry's own page as plain text.
 */
export function EnquiriesPanel({
  tenantId,
  leadId,
  enquiries,
  canWrite,
  formId, words,
}: {
  tenantId: string;
  leadId: string;
  /** null = the API could not be reached / returned something unexpected. */
  enquiries: Enquiry[] | null;
  canWrite: boolean;
  formId: string; words?: Words;
}) {
  const t = makeT(words);
  return (
    <section aria-labelledby="enquiries-heading">
      <h2 id="enquiries-heading" className={pageH2}>{t("enq.enquiries")}</h2>
      <p className={mutedText}>
        {t("enq.paste_an_e_mail_or_whatsapp")}
      </p>
      {enquiries === null ? (
        <p role="alert" className={alertBox}>
          {t("enq.could_not_load_the_enquiries_from")}
        </p>
      ) : enquiries.length === 0 ? (
        <p>{t("enq.no_enquiries_yet")}</p>
      ) : (
        <ul className={listPlain}>
          {enquiries.map((e) => (
            <li key={e.id} className={listItemCard}>
              <Link href={`/app/tenants/${tenantId}/enquiries/${e.id}`} className={link}>
                {t("enq.enquiry_suffix", { channel: t(`enq.channel.${e.channel}`) })}
              </Link>{" "}
              <span className={hintInline}>
                {t("enq.received_word")} <LocalTime iso={e.received_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="mt-4">
          <AddButton label={t("enq.add_enquiry")}>
            <PasteEnquiryForm words={words} action={captureEnquiryAction.bind(null, tenantId, leadId)} enquiryId={formId} />
          </AddButton>
        </div>
      ) : (
        <p className={mutedText}>{t("enq.only_an_owner_admin_or_sales")}</p>
      )}
    </section>
  );
}
