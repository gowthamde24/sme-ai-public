import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { DRAFT_CHANNELS, fetchLeadFollowup, type DraftChannel, type LeadFollowup } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { CreateDraftForm } from "../../../followups/create-draft-form";
import { createDraftAction, recordTouchAction } from "../../../followups/followup-actions";
import { indiaNowLocal } from "../../../followups/followup-logic";
import { LeadFollowupView } from "../../../followups/lead-followup-view";
import { ApiDown, FOLLOWUP_ROLES, Notice, NotShown } from "../../../followups/page-parts";
import { TouchForm } from "../../../followups/touch-form";

export const metadata = { title: "Follow-up · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/leads/[leadId]/followup: one lead's follow-up. Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token. A Viewer sees nothing (and
 * nothing is asked of the API for them). Unknown, malformed and other workspaces' ids produce the SAME not-found page. The page records what a person did and shows closed draft text: it sends nothing.
 */
export default async function LeadFollowupPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/leads/[leadId]/followup">) {
  const user = await requireUser();
  const { tenantId, leadId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShown tenantId={tenantId} tenantName={tenant.name} title="Follow-up" />;

  const asked = pick(query.channel);
  const channel: DraftChannel = (DRAFT_CHANNELS as readonly string[]).includes(asked ?? "") ? (asked as DraftChannel) : "email";
  let data: LeadFollowup;
  try {
    data = await fetchLeadFollowup(user.accessToken, tenantId, leadId, channel);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }

  const maxNow = indiaNowLocal(new Date());
  const ids = { sentTouchIds: Object.fromEntries(data.drafts.map((d) => [d.id, crypto.randomUUID()])), maxNow };
  const forms = (
    <>
      <CreateDraftForm action={createDraftAction.bind(null, tenantId, leadId)} draftId={crypto.randomUUID()} channel={channel} />
      <TouchForm action={recordTouchAction.bind(null, tenantId, leadId)} touchId={crypto.randomUUID()} maxNow={maxNow} />
    </>
  );
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}/leads/${leadId}`}>← Lead</Link> · <Link href={`/app/tenants/${tenantId}/followups`}>Follow-ups due</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <Notice />
      <LeadFollowupView tenantId={tenantId} leadId={leadId} data={data} role={tenant.role} userId={user.id} aal={user.aal} ids={ids} forms={forms} />
    </main>
  );
}
