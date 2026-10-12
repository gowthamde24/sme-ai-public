import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { type ClaimSuggestionOut, fetchClaims } from "@/lib/api/agents";
import { type EvidencePage, fetchEvidencePage } from "@/lib/api/evidence";
import { indiaDayText } from "@/components/v2/app/visits/dates";
import { requireUser } from "@/lib/auth/session";

import { GstinForm } from "@/components/v2/app/gstin/GstinForm";
import { stateOfGstin } from "@/lib/gstin";
import { saveCompanyGstinAction } from "./gstin-actions";
import { EvidencePanel } from "../../evidence-panel";
import { SuggestionsPanel } from "../../suggestions-panel";
import { kvList, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2, BackLink, SectionTabs } from "@/components/v2/app/parts";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Company · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
const REVIEW_ROLES = ["owner", "admin"];
const MAX_CURSOR = 300;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/companies/[companyId]: a short read-only summary plus the company's
 * evidence (plain text, see EvidencePanel). Server-side only; requireUser() runs FIRST and every
 * data call goes to OUR API with the user's own token. A tenant or company that does not exist, is
 * malformed, or belongs to someone else produces the SAME not-found page (the API answers 404 for
 * all of them and this page never says which).
 */
export default async function CompanyPage({
  params,
  searchParams,
}: PageProps<"/app/tenants/[tenantId]/companies/[companyId]">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["comp.", "ag.", "ws.", "gst."], ["dta.btn.working", "apierr.generic", "apierr.forbidden", "apierr.mfa", "apierr.rate", "apierr.rate.n", "apierr.invalid", "apierr.security_link", "apierr.unavailable", "apierr.not_found", "apierr.conflict", "apierr.too_big"]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId, companyId } = await params;
  const query = await searchParams;

  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(companyId)) notFound();

  let tenant;
  let company;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
    company = await fetchCompany(user.accessToken, tenantId, companyId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }

  const rawCursor = pick(query.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : null;
  let page: EvidencePage | null = null;
  try {
    page = await fetchEvidencePage(
      user.accessToken,
      tenantId,
      "companies",
      companyId,
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
    claims = await fetchClaims(user.accessToken, tenantId, "companies", companyId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
  }
  const reviewIds = Object.fromEntries(
    (claims ?? []).map((c) => [c.id, { accept: crypto.randomUUID(), reject: crypto.randomUUID() }]),
  );

  // One part of the screen at a time (Job X): the details, the evidence, the suggestions. A paged evidence list opens on the evidence.
  const wanted = pick(query.section);
  // `?section=all` draws every part on one page (the screen as it was before it was split: for printing, and for the tests that pin the whole screen).
  const section: "all" | "details" | "evidence" | "suggestions" = wanted === "evidence" || wanted === "suggestions" || wanted === "details" || wanted === "all" ? wanted : cursor ? "evidence" : "details";
  const here = `/app/tenants/${tenantId}/companies/${companyId}`;
  const parts = [
    { key: "details", label: t("comp.tab_details"), href: `${here}?section=details`, current: section === "details" },
    { key: "evidence", label: t("comp.tab_evidence"), href: `${here}?section=evidence`, current: section === "evidence" },
    { key: "suggestions", label: claims && claims.length > 0 ? t("comp.tab_suggestions_n", { n: claims.length }) : t("comp.tab_suggestions"), href: `${here}?section=suggestions`, current: section === "suggestions" },
  ];

  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}?tab=companies`} label={t("comp.all_customers")} />
      <h1 className={pageH1}>{company.name}</h1>

      {section !== "all" ? <SectionTabs label={t("comp.parts_of_this_company")} items={parts} /> : null}
      {section === "details" || section === "all" ? (
        <>
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className={pageH2}>{t("comp.company")}</h2>
          <dl className={kvList}>
            <dt>{t("comp.type")}</dt>
            <dd>{company.type}</dd>
            <dt>{t("comp.website")}</dt>
            <dd>{company.website ?? "—"}</dd>
            <dt>{t("comp.country")}</dt>
            <dd>{company.country ?? "—"}</dd>
            <dt>{t("comp.city")}</dt>
            <dd>{company.city ?? "—"}</dd>
            <dt>{t("comp.industry")}</dt>
            <dd>{company.industry ?? "—"}</dd>
            <dt>{t("gst.label")}</dt>
            <dd>{company.gstin ?? "—"}</dd>
            <dt>{t("comp.created")}</dt>
            <dd>{indiaDayText(company.created_at)}</dd>
            <dt>{t("comp.origin")}</dt>
            <dd>{company.created_via}</dd>
          </dl>
        </section>
        {WRITE_ROLES.includes(tenant.role) ? (
          <GstinForm
            words={words}
            title={t("gst.customer.title")}
            personal
            initial={{ gstin: company.gstin, state: company.gstin ? stateOfGstin(company.gstin) : null }}
            canEdit
            save={saveCompanyGstinAction.bind(null, tenantId, companyId)}
          />
        ) : null}
        </>
      ) : null}
      {section === "evidence" || section === "all" ? (
        <>
        <EvidencePanel
          words={words}
          tenantId={tenantId}
          target="companies"
          targetId={companyId}
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
          target="companies"
          targetId={companyId}
          claims={claims}
          canReview={REVIEW_ROLES.includes(tenant.role)}
          reviewIds={reviewIds}
        />
        </>
      ) : null}
    </main>
  );
}

