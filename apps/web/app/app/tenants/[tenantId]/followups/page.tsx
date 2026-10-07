import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchDueList, type DueItem } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { DueView } from "./due-view";
import { ApiDown, FOLLOWUP_ROLES, Notice, NotShown } from "./page-parts";

export const metadata = { title: "Follow-ups due · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/followups: the due list. A Viewer sees nothing and nothing is asked of the API for them. */
export default async function FollowupsPage({ params }: PageProps<"/app/tenants/[tenantId]/followups">) {
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
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShown tenantId={tenantId} tenantName={tenant.name} title="Follow-ups due" />;

  let items: DueItem[];
  try {
    items = await fetchDueList(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDown />;
  }
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link> · <Link href={`/app/tenants/${tenantId}/followups/policy`}>The follow-up policy</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <Notice />
      <DueView tenantId={tenantId} items={items} />
    </main>
  );
}
