import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { CHANNELS, type ConsentChannel } from "@/lib/api/consent";
import { fetchContact, isCanonicalUuid, type ContactRow } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { recordConsentAction } from "./actions";
import { ConsentForm } from "./consent-form";
import { bodyText, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2, BackLink } from "@/components/v2/app/parts";
import { Rich } from "@/components/v2/app/rich";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Record consent · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "sales"];
const FIELD: Record<ConsentChannel, "whatsapp_consent" | "phone_consent" | "email_consent"> = { whatsapp: "whatsapp_consent", phone: "phone_consent", email: "email_consent" };

/**
 * /app/tenants/[tenantId]/contacts/[contactId]/consent: write down a consent entry for one person and one channel (Owner, Admin or Sales). Server-side; requireUser() runs FIRST and every call goes to OUR
 * API with the user's own token. Anyone else sees a plain notice and nothing is asked of the API for them. The page shows the person's name and the three states, never the number or the address.
 */
export default async function ConsentPage({ params }: PageProps<"/app/tenants/[tenantId]/contacts/[contactId]/consent">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["cont."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId, contactId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  const back = <BackLink href={`/app/tenants/${tenantId}?tab=contacts`} label={t("cont.all_customers")} />;
  if (!WRITERS.includes(tenant.role))
    return (
      <main className={pageMain} lang={lang}>
        {back}
        <h1 className={pageH1}>{t("cont.record_consent")}</h1>
        <p className={bodyText}>{t("cont.an_owner_an_admin_or_a")}</p>
      </main>
    );

  let contact: ContactRow;
  try {
    contact = await fetchContact(user.accessToken, tenantId, contactId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  return (
    <main className={pageMain} lang={lang}>
      {back}
      <h1 className={pageH1}>{t("cont.record_consent")}</h1>
      <p className={bodyText}>
        <Rich t={t} k="cont.for_line" with={{ name: <strong>{contact.full_name}</strong> }} />
      </p>
      <section aria-labelledby="now-heading">
        <h2 id="now-heading" className={pageH2}>{t("cont.what_is_recorded_now")}</h2>
        <ul>
          {CHANNELS.map((c) => (
            <li key={c}>
              {t(`cont.channel.${c}`)}: {t(`cont.status.${contact[FIELD[c]]}`)}
            </li>
          ))}
        </ul>
        {contact.suppression_reason !== null && <p className={mutedText}>{t("cont.suppressed_note", { reason: contact.suppression_reason })}</p>}
      </section>
      <section aria-labelledby="record-heading">
        <h2 id="record-heading" className={pageH2}>{t("cont.write_down_an_entry")}</h2>
        <ConsentForm words={words} action={recordConsentAction.bind(null, tenantId, contactId)} />
      </section>
    </main>
  );
}

