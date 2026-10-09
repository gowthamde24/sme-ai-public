import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuotePolicyVersions, type QuotePolicyVersion } from "@/lib/api/quote-policies";
import { requireUser } from "@/lib/auth/session";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, link, mutedText, noteBox, pageH1, pageMain } from "@/components/v2/app/ui";

import { todayInIndia } from "../followups/page-parts";
import { publishQuotePolicyAction } from "./quote-policy-actions";
import { QuotePolicyForm } from "./quote-policy-form";
import { QuotePolicyView } from "./quote-policy-view";

export const metadata = { title: "Quote policy · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ROLES = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/quote-policy: the published quote policy versions, and (for an owner or an admin, with the authenticator app) a form to publish a new one. Every other role gets one plain
 * sentence and nothing else: no list and no form. The page makes ONE new id per render for the form.
 */
export default async function QuotePolicyPage({ params }: PageProps<"/app/tenants/[tenantId]/quote-policy">) {
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
  if (!ROLES.includes(tenant.role))
    return (
      <main className={pageMain}>
        <p>
          <Link href={`/app/tenants/${tenantId}`} className={backLink}>
            ← {tenant.name}
          </Link>
        </p>
        <h1 className={pageH1}>The quote policy</h1>
        <p className={mutedText}>Only an owner or an admin can see and publish the quote policy.</p>
      </main>
    );

  let versions: QuotePolicyVersion[];
  try {
    versions = await fetchQuotePolicyVersions(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  const today = todayInIndia(new Date());
  // A new version cannot start before today or before the newest published version (the database decides again).
  const newest = versions.reduce((latest, v) => (v.effective_from > latest ? v.effective_from : latest), "");
  const minDate = newest > today ? newest : today;
  const form =
    user.aal !== "aal2" ? (
      <p role="note" className={noteBox}>
        Publishing a quote policy needs your authenticator app.{" "}
        <Link href="/app/security" className={link}>
          Set it up on the Security page
        </Link>
        , then sign in again with its code.
      </p>
    ) : (
      <QuotePolicyForm action={publishQuotePolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} minDate={minDate} />
    );
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}`} className={backLink}>
          ← {tenant.name}
        </Link>
      </p>
      <p className={mutedText}>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <QuotePolicyView versions={versions} today={today} form={form} />
    </main>
  );
}
