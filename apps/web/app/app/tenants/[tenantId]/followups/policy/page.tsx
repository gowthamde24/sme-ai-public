import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchPolicyVersions, type PolicyVersion } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { createPolicyAction } from "../followup-actions";
import { ApiDown, FOLLOWUP_ROLES, Notice, NotShown, todayInIndia } from "../page-parts";
import { PolicyForm } from "../policy-form";
import { PolicyView } from "../policy-view";

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
    return <ApiDown />;
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShown tenantId={tenantId} tenantName={tenant.name} title="The follow-up policy" />;

  let versions: PolicyVersion[];
  try {
    versions = await fetchPolicyVersions(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDown />;
  }
  const today = todayInIndia(new Date());
  const form =
    tenant.role === "owner" ? (
      <PolicyForm action={createPolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} secondFactorMissing={user.aal !== "aal2"} />
    ) : (
      <p className="hint">Only the owner publishes a policy.</p>
    );
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}/followups`}>← Follow-ups due</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <Notice />
      <PolicyView versions={versions} today={today} form={form} />
    </main>
  );
}
