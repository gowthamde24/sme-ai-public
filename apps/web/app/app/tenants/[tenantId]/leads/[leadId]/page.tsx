import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchLead, isCanonicalUuid } from "@/lib/api/crm";
import { type ClaimSuggestionOut, fetchClaims } from "@/lib/api/agents";
import { type Enquiry, fetchLeadEnquiries } from "@/lib/api/enquiries";
import { type EvidencePage, fetchEvidencePage } from "@/lib/api/evidence";
import { requireUser } from "@/lib/auth/session";

import { EnquiriesPanel } from "../../enquiries/enquiries-panel";
import { EvidencePanel } from "../../evidence-panel";
import { SuggestionsPanel } from "../../suggestions-panel";

export const metadata = { title: "Lead · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
const REVIEW_ROLES = ["owner", "admin"];
const MAX_CURSOR = 300;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/leads/[leadId]: a short read-only summary plus the lead's
 * evidence (plain text, see EvidencePanel). Server-side only; requireUser() runs FIRST and every
 * data call goes to OUR API with the user's own token. A tenant or lead that does not exist, is
 * malformed, or belongs to someone else produces the SAME not-found page (the API answers 404 for
 * all of them and this page never says which).
 */
export default async function LeadPage({
  params,
  searchParams,
}: PageProps<"/app/tenants/[tenantId]/leads/[leadId]">) {
  const user = await requireUser();
  const { tenantId, leadId } = await params;
  const query = await searchParams;

  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) notFound();

  let tenant;
  let lead;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
    lead = await fetchLead(user.accessToken, tenantId, leadId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }

  const rawCursor = pick(query.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : null;
  let page: EvidencePage | null = null;
  try {
    page = await fetchEvidencePage(
      user.accessToken,
      tenantId,
      "leads",
      leadId,
      cursor,
    );
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the evidence section shows an error, never placeholder data
  }

  // Agent suggestions: a failure here shows an error in that section only, never placeholder data.
  let claims: ClaimSuggestionOut[] | null = null;
  try {
    claims = await fetchClaims(user.accessToken, tenantId, "leads", leadId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
  }
  // Enquiries pasted onto this lead: a failure shows an error in that section only.
  let enquiries: Enquiry[] | null = null;
  try {
    enquiries = await fetchLeadEnquiries(user.accessToken, tenantId, leadId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
  }
  const reviewIds = Object.fromEntries(
    (claims ?? []).map((c) => [c.id, { accept: crypto.randomUUID(), reject: crypto.randomUUID() }]),
  );

  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}?tab=leads`}>← {tenant.name}</Link>
      </p>
      <h1>Lead</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading">Lead</h2>
        <dl className="summary">
          <dt>Status</dt>
          <dd>{lead.status}</dd>
          <dt>Source</dt>
          <dd>{lead.source ?? "—"}</dd>
          <dt>Created</dt>
          <dd>{lead.created_at.slice(0, 10)}</dd>
          <dt>Origin</dt>
          <dd>{lead.created_via}</dd>
        </dl>
      </section>

      <EnquiriesPanel
        tenantId={tenantId}
        leadId={leadId}
        enquiries={enquiries}
        canWrite={WRITE_ROLES.includes(tenant.role)}
        formId={crypto.randomUUID()}
      />

      <EvidencePanel
        tenantId={tenantId}
        target="leads"
        targetId={leadId}
        page={page}
        cursor={cursor}
        canWrite={WRITE_ROLES.includes(tenant.role)}
        formId={crypto.randomUUID()}
      />

      <SuggestionsPanel
        tenantId={tenantId}
        target="leads"
        targetId={leadId}
        claims={claims}
        canReview={REVIEW_ROLES.includes(tenant.role)}
        reviewIds={reviewIds}
      />
    </main>
  );
}

function ApiDown() {
  return (
    <main className="shell wide">
      <p role="alert" className="error">
        Could not load this from the API. Try again shortly.
      </p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}
