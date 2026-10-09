import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { CHANNELS, CHANNEL_LABELS, STATUS_LABELS, type ConsentChannel } from "@/lib/api/consent";
import { fetchContact, isCanonicalUuid, type ContactRow } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { recordConsentAction } from "./actions";
import { ConsentForm } from "./consent-form";
import { backLink, bodyText, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";

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
  const user = await requireUser();
  const { tenantId, contactId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  const back = (
    <p>
      <Link href={`/app/tenants/${tenantId}?tab=contacts`} className={backLink}>← {tenant.name}</Link>
    </p>
  );
  if (!WRITERS.includes(tenant.role))
    return (
      <main className={pageMain}>
        <h1 className={pageH1}>Record consent</h1>
        <p className={bodyText}>An owner, an admin or a sales person records consent.</p>
      </main>
    );

  let contact: ContactRow;
  try {
    contact = await fetchContact(user.accessToken, tenantId, contactId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  return (
    <main className={pageMain}>
      <h1 className={pageH1}>Record consent</h1>
      <p className={bodyText}>
        For <strong>{contact.full_name}</strong>.
      </p>
      <section aria-labelledby="now-heading">
        <h2 id="now-heading" className={pageH2}>What is recorded now</h2>
        <ul>
          {CHANNELS.map((c) => (
            <li key={c}>
              {CHANNEL_LABELS[c]}: {STATUS_LABELS[contact[FIELD[c]]]}
            </li>
          ))}
        </ul>
        {contact.suppression_reason !== null && <p className={mutedText}>This person is marked as not to be contacted ({contact.suppression_reason}). Writing down consent here does not change that.</p>}
      </section>
      <section aria-labelledby="record-heading">
        <h2 id="record-heading" className={pageH2}>Write down an entry</h2>
        <ConsentForm action={recordConsentAction.bind(null, tenantId, contactId)} />
      </section>
    </main>
  );
}

