import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchSuppressionStatus, suppressionReadiness, type SuppressionStatus } from "@/lib/api/suppression";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";
import { backfillKeysAction } from "./actions";
import { BackfillForm } from "./suppression-form";
import { alertBox, backLink, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";

export const metadata = { title: "Suppression keys · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/suppression: which contacts still have no suppression key, and the backfill (ADR 0020). Owner only. Server-side; requireUser() runs FIRST and every call goes to OUR API with
 * the user's own token. Anyone who is not the owner sees a plain notice and nothing is asked of the API for them. The page shows only what the API returns: counts, never a key, an address or a number.
 *
 * It must not read as "all clear" while a contact has no key: the headline comes from one function of the status the API just returned, and anything unknown is "not ready".
 */
export default async function SuppressionPage({ params }: PageProps<"/app/tenants/[tenantId]/suppression">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

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
      <Link href={`/app/tenants/${tenantId}`} className={backLink}>← {tenant.name}</Link>
    </p>
  );
  if (tenant.role !== "owner")
    return (
      <main className={pageMain}>
        {back}
        <h1 className={pageH1}>Suppression keys</h1>
        <p>Only the owner records suppression keys.</p>
      </main>
    );

  let status: SuppressionStatus | null = null;
  try {
    status = await fetchSuppressionStatus(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the headline says NOT ready and shows no number, never a placeholder
  }
  const readiness = suppressionReadiness(status);
  const checkedAt = new Date().toISOString();

  return (
    <main className={pageMain}>
      {back}
      <h1 className={pageH1}>Suppression keys</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p className={mutedText}>
        A suppression key lets the system remember that a person asked not to be contacted, even after their details are erased. A contact without a key can never receive a follow-up draft. Contacts made
        before the key was set up, or straight through the database, have none until you record them here. Nothing is sent to anyone, and no key or address is shown on this page.
      </p>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className={pageH2}>Status</h2>
        {readiness === "unavailable" && (
          <p role="alert" className={alertBox}>
            <strong>NOT ready.</strong> Could not read the suppression status from the API. Try again shortly.
          </p>
        )}
        {readiness === "no_key" && (
          <p role="alert" className={alertBox}>
            <strong>NOT ready.</strong> The suppression key is not set up on the server, so contacts cannot be keyed. This is a setting of whoever runs the server, not something to fix on this page.
          </p>
        )}
        {readiness === "unkeyed" && (
          <p role="alert" className={alertBox}>
            <strong>NOT ready.</strong>{" "}
            {status?.unkeyed_contacts === null
              ? "The number of contacts without a key is not known."
              : `${status?.unkeyed_contacts} ${status?.unkeyed_contacts === 1 ? "contact has" : "contacts have"} no suppression key.`}{" "}
            They cannot receive a follow-up draft until they have one.
          </p>
        )}
        {readiness === "clear" && (
          <p role="status">
            No contact is waiting for a key. This is one condition before the first outreach; it does not open the real-data gate, and a contact made later straight through the database would need a key again.
          </p>
        )}
        {status !== null && (
          <p className={mutedText}>
            Checked <LocalTime iso={checkedAt} />.{status.key_version !== null && ` Key version in use: ${status.key_version}.`}
          </p>
        )}
      </section>

      {(readiness === "unkeyed" || readiness === "clear") && (
        <section aria-labelledby="backfill-heading">
          <h2 id="backfill-heading" className={pageH2}>Record keys</h2>
          <BackfillForm action={backfillKeysAction.bind(null, tenantId)} secondFactorMissing={user.aal !== "aal2"} />
        </section>
      )}
    </main>
  );
}
