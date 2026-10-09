import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchPolicyVersions, type PolicyVersion } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { createPolicyAction } from "../followup-actions";
import { FOLLOWUP_ROLES, NOTHING_SENT, todayInIndia } from "../page-parts";
import { ApiDownV2, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { PolicyForm } from "../policy-form";
import { PolicyView } from "../policy-view";
import { backLink, mutedText, pageMain } from "@/components/v2/app/ui";

export const metadata = { title: "Follow-up policy · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/followups/policy: the policy versions; the Owner (with the authenticator app) publishes a new one. A Viewer sees nothing. */
export default async function PolicyPage({ params }: PageProps<"/app/tenants/[tenantId]/followups/policy">) {
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
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title="The follow-up policy" message="Follow-ups are shown to owners, admins and sales users." />;

  let versions: PolicyVersion[];
  try {
    versions = await fetchPolicyVersions(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  const today = todayInIndia(new Date());
  const form =
    tenant.role === "owner" ? (
      <PolicyForm action={createPolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} secondFactorMissing={user.aal !== "aal2"} />
    ) : (
      <p className={mutedText}>Only the owner publishes a policy.</p>
    );
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}/followups`} className={backLink}>← Follow-ups due</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <NoticeV2>{NOTHING_SENT}</NoticeV2>
      <PolicyView versions={versions} today={today} form={form} />
    </main>
  );
}
