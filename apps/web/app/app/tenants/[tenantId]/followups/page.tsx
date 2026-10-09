import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchDueList, isDueCursor, type DueList } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { DueView } from "./due-view";
import { FOLLOWUP_ROLES, NOTHING_SENT } from "./page-parts";
import { ApiDownV2, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";

export const metadata = { title: "Follow-ups due · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/followups: one page of the due list (`?after=` is the cursor of the previous page). A Viewer sees nothing and nothing is asked of the API for them. */
export default async function FollowupsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/followups">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
  const asked = Array.isArray(query.after) ? query.after[0] : query.after;
  const after = isDueCursor(asked) ? asked : undefined; // a cursor that is not ours is ignored: the first page
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title="Follow-ups due" message="Follow-ups are shown to owners, admins and sales users." />;

  let list: DueList;
  try {
    list = await fetchDueList(user.accessToken, tenantId, after);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}`} className={backLink}>← {tenant.name}</Link> · <Link href={`/app/tenants/${tenantId}/followups/policy`}>The follow-up policy</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <NoticeV2>{NOTHING_SENT}</NoticeV2>
      <DueView tenantId={tenantId} list={list} />
    </main>
  );
}
