import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, fetchLead, isCanonicalUuid } from "@/lib/api/crm";
import { appT } from "@/i18n/app";
import { indiaDayText } from "@/components/v2/app/visits/dates";
import { type ClaimSuggestionOut, fetchClaims } from "@/lib/api/agents";
import { type Enquiry, fetchLeadEnquiries } from "@/lib/api/enquiries";
import { type EvidencePage, fetchEvidencePage } from "@/lib/api/evidence";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import { take } from "@/lib/api/settled";
import { requireUser } from "@/lib/auth/session";
import { ContactLead } from "@/components/v2/app/contact/ContactLead";
import { getLang } from "@/i18n/get-lang";
import { wordsFor } from "@/i18n/app-words";

import { EnquiriesPanel } from "../../enquiries/enquiries-panel";
import { indiaNowLocal } from "../../followups/followup-logic";
import { EvidencePanel } from "../../evidence-panel";
import { SuggestionsPanel } from "../../suggestions-panel";
import { contactWhatsAppAction, requestCallAction } from "./contact-actions";
import { contactWords } from "./contact-words";
import { recordSentMessageAction } from "./sent-message-actions";
import { SentMessageForm } from "./sent-message-form";
import { foldBody, foldCard, foldSummary, kvList, link, mutedText, pageH1, pageH2, pageMain, pageSub } from "@/components/v2/app/ui";
import { ApiDownV2, BackLink, SectionTabs } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";

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
      <ApiDownV2 words={await partsWords()} />
    );
  }

  // The workspace and the lead are read first, one after the other: nothing else is asked about a workspace or a lead the person cannot see (pinned by page.test.tsx). Everything after them does not depend on
  // anything else, so it is asked at the same time (job CH), and each failure is handled below where it was when they ran one after another. Before: six reads in a row; now three steps.
  const rawCursor = pick(query.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : null;
  const [evidenceRead, claimsRead, enquiriesRead, contactRead, companyRead] = await Promise.allSettled([
    fetchEvidencePage(user.accessToken, tenantId, "leads", leadId, cursor),
    fetchClaims(user.accessToken, tenantId, "leads", leadId),
    fetchLeadEnquiries(user.accessToken, tenantId, leadId),
    // the contact is asked only for a role that writes (known from the workspace read); the customer's name needs the lead
    WRITE_ROLES.includes(tenant.role) ? fetchLeadContactId(user.accessToken, tenantId, leadId) : Promise.resolve(undefined),
    lead.company_id ? fetchCompany(user.accessToken, tenantId, lead.company_id) : Promise.resolve(null),
  ]);
  let page: EvidencePage | null = null;
  try {
    page = take(evidenceRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the evidence section shows an error, never placeholder data
  }

  // Agent suggestions: a failure here shows an error in that section only, never placeholder data.
  let claims: ClaimSuggestionOut[] | null = null;
  try {
    claims = take(claimsRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
  }
  // Enquiries pasted onto this lead: a failure shows an error in that section only.
  let enquiries: Enquiry[] | null = null;
  try {
    enquiries = take(enquiriesRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
  }
  // The contact this lead is linked to (only to point at its consent page): null = none, undefined = could not be read (the form is still offered; the database decides).
  let contactId: string | null | undefined;
  try {
    contactId = take(contactRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  // One part of the screen at a time (Job X): the summary with what to do next, the evidence, the suggestions. A paged evidence list opens on the evidence.
  const wanted = pick(query.section);
  // `?section=all` draws every part on one page (the screen as it was before it was split: for printing, and for the tests that pin the whole screen).
  const section: "all" | "overview" | "evidence" | "suggestions" = wanted === "evidence" || wanted === "suggestions" || wanted === "overview" || wanted === "all" ? wanted : cursor ? "evidence" : "overview";
  const here = `/app/tenants/${tenantId}/leads/${leadId}`;
  const lang = await getLang();
  const t = appT(lang);
  const words = wordsFor(lang, ["lead.", "ag.", "enq.", "fu.", "ws."]);
  const parts = [
    { key: "overview", label: t("lead.tab.overview"), href: `${here}?section=overview`, current: section === "overview" },
    { key: "evidence", label: t("lead.tab.evidence"), href: `${here}?section=evidence`, current: section === "evidence" },
    { key: "suggestions", label: claims && claims.length > 0 ? `${t("lead.tab.suggestions")} (${claims.length})` : t("lead.tab.suggestions"), href: `${here}?section=suggestions`, current: section === "suggestions" },
  ];
  // The customer's name is the page's title ("Lead" says nothing to the person); a read that fails falls back to the plain word.
  let company: { name: string; city: string | null } | null = null;
  try {
    company = take(companyRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  const statusKey = `lead.status.${lead.status}` as "lead.status.new";
  const originKey = `lead.origin.${lead.created_via}` as "lead.origin.manual";
  const statusText = lead.status in { new: 1, in_review: 1, qualified: 1, disqualified: 1 } ? t(statusKey) : lead.status;
  const originText = lead.created_via in { manual: 1, import: 1, agent: 1 } ? t(originKey) : lead.created_via;
  const sentId = crypto.randomUUID(); // one id per render: a second press of "Record this" is a retry
  const reviewIds = Object.fromEntries(
    (claims ?? []).map((c) => [c.id, { accept: crypto.randomUUID(), reject: crypto.randomUUID() }]),
  );

  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/review`} label={t("lead.back")} />
      <h1 className={pageH1}>{company?.name ?? t("lead.untitled")}</h1>
      <p className={pageSub}>
        {company?.city ? `${company.city} · ` : ""}
        {statusText}
      </p>
      {WRITE_ROLES.includes(tenant.role) ? (
        <p>
          <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup`} className={link}>
            {t("lead.followup")} →
          </Link>
        </p>
      ) : null}

      {section !== "all" ? <SectionTabs label={t("lead.tabs")} items={parts} /> : null}
      {section === "overview" || section === "all" ? (
        <>
        {WRITE_ROLES.includes(tenant.role) ? (
          <ContactLead
            words={contactWords(await getLang())}
            actions={{ whatsapp: contactWhatsAppAction.bind(null, tenantId, leadId), call: requestCallAction.bind(null, tenantId, leadId) }}
            bookHref={`/app/tenants/${tenantId}/visits?lead=${leadId}#book`}
            sareeHref={`/app/tenants/${tenantId}/catalogue?lead=${leadId}`}
            todayHref={`/app/tenants/${tenantId}#needs-you`}
            addCustomerHref={`/app/tenants/${tenantId}/customers/new`}
            noContact={contactId === null}
          />
        ) : null}
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className={pageH2}>{t("lead.about")}</h2>
          <dl className={kvList}>
            <dt>{t("lead.status")}</dt>
            <dd>{statusText}</dd>
            <dt>{t("lead.source")}</dt>
            <dd>{lead.source ?? "—"}</dd>
            <dt>{t("lead.added")}</dt>
            <dd>{indiaDayText(lead.created_at, lang)}</dd>
            <dt>{t("lead.origin")}</dt>
            <dd>{originText}</dd>
          </dl>
        </section>

        <EnquiriesPanel
          words={words}
          tenantId={tenantId}
          leadId={leadId}
          enquiries={enquiries}
          canWrite={WRITE_ROLES.includes(tenant.role)}
          formId={crypto.randomUUID()}
        />

        {!WRITE_ROLES.includes(tenant.role) || contactId === null ? null : (
          <details data-part="sent-by-hand" className={foldCard}>
            <summary className={foldSummary}>{t("lead.sent.title")}</summary>
            <div className={foldBody}>
              <p className={mutedText}>{t("lead.sent.hint")}</p>
            <SentMessageForm
              words={words}
              key={sentId}
              action={recordSentMessageAction.bind(null, tenantId, leadId)}
              tenantId={tenantId}
              touchId={sentId}
              maxNow={indiaNowLocal(new Date())}
              contactId={contactId ?? null}
            />
            </div>
          </details>
        )}

        </>
      ) : null}
      {section === "evidence" || section === "all" ? (
        <>
        <EvidencePanel
          words={words}
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
          words={words}
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

