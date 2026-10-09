import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchLead, isCanonicalUuid } from "@/lib/api/crm";
import { type ClaimSuggestionOut, fetchClaims } from "@/lib/api/agents";
import { type Enquiry, fetchLeadEnquiries } from "@/lib/api/enquiries";
import { type EvidencePage, fetchEvidencePage } from "@/lib/api/evidence";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import { requireUser } from "@/lib/auth/session";

import { EnquiriesPanel } from "../../enquiries/enquiries-panel";
import { indiaNowLocal } from "../../followups/followup-logic";
import { EvidencePanel } from "../../evidence-panel";
import { SuggestionsPanel } from "../../suggestions-panel";
import { recordSentMessageAction } from "./sent-message-actions";
import { SentMessageForm } from "./sent-message-form";
import { bodyText, kvList, link, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2, BackLink, SectionTabs } from "@/components/v2/app/parts";

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
    return (
      <ApiDownV2 />
    );
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
  // The contact this lead is linked to (only to point at its consent page): null = none, undefined = could not be read (the form is still offered; the database decides).
  let contactId: string | null | undefined;
  if (WRITE_ROLES.includes(tenant.role)) {
    try {
      contactId = await fetchLeadContactId(user.accessToken, tenantId, leadId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
    }
  }
  // One part of the screen at a time (Job X): the summary with what to do next, the evidence, the suggestions. A paged evidence list opens on the evidence.
  const wanted = pick(query.section);
  // `?section=all` draws every part on one page (the screen as it was before it was split: for printing, and for the tests that pin the whole screen).
  const section: "all" | "overview" | "evidence" | "suggestions" = wanted === "evidence" || wanted === "suggestions" || wanted === "overview" || wanted === "all" ? wanted : cursor ? "evidence" : "overview";
  const here = `/app/tenants/${tenantId}/leads/${leadId}`;
  const parts = [
    { key: "overview", label: "Overview", href: `${here}?section=overview`, current: section === "overview" },
    { key: "evidence", label: "Evidence", href: `${here}?section=evidence`, current: section === "evidence" },
    { key: "suggestions", label: claims && claims.length > 0 ? `Suggestions (${claims.length})` : "Suggestions", href: `${here}?section=suggestions`, current: section === "suggestions" },
  ];
  const sentId = crypto.randomUUID(); // one id per render: a second press of "Record this" is a retry
  const reviewIds = Object.fromEntries(
    (claims ?? []).map((c) => [c.id, { accept: crypto.randomUUID(), reject: crypto.randomUUID() }]),
  );

  return (
    <main className={pageMain}>
      <BackLink href={`/app/tenants/${tenantId}/review`} label="All leads" />
      <h1 className={pageH1}>Lead</h1>
      {WRITE_ROLES.includes(tenant.role) ? (
        <p>
          <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup`} className={link}>
            Follow-up for this lead →
          </Link>
        </p>
      ) : null}

      {section !== "all" ? <SectionTabs label="Parts of this lead" items={parts} /> : null}
      {section === "overview" || section === "all" ? (
        <>
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className={pageH2}>Lead</h2>
          <dl className={kvList}>
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

        <section aria-labelledby="sent-heading">
          <h2 id="sent-heading" className={pageH2}>I sent a message</h2>
          {!WRITE_ROLES.includes(tenant.role) ? (
            <p className={bodyText}>An owner, an admin or a sales person records that a message was sent.</p>
          ) : contactId === null ? (
            <p role="note">
              This lead has no contact attached, so a message to them cannot be recorded.{" "}
              <Link href={`/app/tenants/${tenantId}/customers/new`} className={link}>
                Add the customer first →
              </Link>
            </p>
          ) : (
            <SentMessageForm
              key={sentId}
              action={recordSentMessageAction.bind(null, tenantId, leadId)}
              tenantId={tenantId}
              touchId={sentId}
              maxNow={indiaNowLocal(new Date())}
              contactId={contactId ?? null}
            />
          )}
        </section>

        </>
      ) : null}
      {section === "evidence" || section === "all" ? (
        <>
        <EvidencePanel
          tenantId={tenantId}
          target="leads"
          targetId={leadId}
          page={page}
          cursor={cursor}
          canWrite={WRITE_ROLES.includes(tenant.role)}
          formId={crypto.randomUUID()}
        />
        </>
      ) : null}
      {section === "suggestions" || section === "all" ? (
        <>
        <SuggestionsPanel
          tenantId={tenantId}
          target="leads"
          targetId={leadId}
          claims={claims}
          canReview={REVIEW_ROLES.includes(tenant.role)}
          reviewIds={reviewIds}
        />
        </>
      ) : null}
    </main>
  );
}

