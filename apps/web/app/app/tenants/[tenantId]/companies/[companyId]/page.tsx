import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { type ClaimSuggestionOut, fetchClaims } from "@/lib/api/agents";
import { type EvidencePage, fetchEvidencePage } from "@/lib/api/evidence";
import { requireUser } from "@/lib/auth/session";

import { EvidencePanel } from "../../evidence-panel";
import { SuggestionsPanel } from "../../suggestions-panel";

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
    return <ApiDown />;
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

  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}?tab=companies`}>
          ← {tenant.name}
        </Link>
      </p>
      <h1>{company.name}</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading">Company</h2>
        <dl className="summary">
          <dt>Type</dt>
          <dd>{company.type}</dd>
          <dt>Website</dt>
          <dd>{company.website ?? "—"}</dd>
          <dt>Country</dt>
          <dd>{company.country ?? "—"}</dd>
          <dt>City</dt>
          <dd>{company.city ?? "—"}</dd>
          <dt>Industry</dt>
          <dd>{company.industry ?? "—"}</dd>
          <dt>Created</dt>
          <dd>{company.created_at.slice(0, 10)}</dd>
          <dt>Origin</dt>
          <dd>{company.created_via}</dd>
        </dl>
      </section>

      <EvidencePanel
        tenantId={tenantId}
        target="companies"
        targetId={companyId}
        page={page}
        cursor={cursor}
        canWrite={WRITE_ROLES.includes(tenant.role)}
        formId={crypto.randomUUID()}
      />

      <SuggestionsPanel
        tenantId={tenantId}
        target="companies"
        targetId={companyId}
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
