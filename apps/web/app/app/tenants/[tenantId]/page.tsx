import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import {
  type CrmPage,
  ENTITY_KEYS,
  type EntityKey,
  fetchPage,
  isCanonicalUuid,
} from "@/lib/api/crm";
import { fetchDataPolicy } from "@/lib/api/erasure";
import { alertBox, bodyText, dataTable, dataTd, dataThCol, dataTr, inlineLink, link, pageH1, pageH2, pageMain, spaceTop, tabLink, tabLinkOn, tabRow, warnBox } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { createCompanyAction } from "./actions";
import { CreateCompanyForm } from "./create-company-form";

export const metadata = { title: "Workspace · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const LABELS: Record<EntityKey, string> = {
  companies: "Companies",
  contacts: "Contacts",
  products: "Products",
  leads: "Leads",
  opportunities: "Opportunities",
};
const WRITE_ROLES = ["owner", "admin", "sales"];
const MAX_CURSOR = 300;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]: one workspace, five read-only tables, one create form.
 *
 * Server-side only. requireUser() runs FIRST; every data call goes to OUR API with the user's own
 * token (the web never talks to PostgREST). A tenant that does not exist, is malformed, or that the
 * caller does not belong to produces the SAME not-found page: the API answers 404 for all three and
 * this page never says which.
 */
export default async function TenantPage({
  params,
  searchParams,
}: PageProps<"/app/tenants/[tenantId]">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;

  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return (
      <ApiDown />
    );
  }

  const requestedTab = pick(query.tab);
  const tab: EntityKey = (ENTITY_KEYS as readonly string[]).includes(
    requestedTab ?? "",
  )
    ? (requestedTab as EntityKey)
    : "companies";
  const rawCursor = pick(query.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : null;

  let page: CrmPage | null = null;
  try {
    page = await fetchPage(user.accessToken, tenantId, tab, cursor);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: show an error, never placeholder data
  }

  // The real-data gate. A failure to read it shows no banner (never a claim either way); the database enforces the gate regardless.
  let syntheticOnly = false;
  try {
    syntheticOnly = !(await fetchDataPolicy(user.accessToken, tenantId)).real_data_allowed;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }

  const canWrite = WRITE_ROLES.includes(tenant.role);
  const formId = crypto.randomUUID();

  return (
    <main className={pageMain}>
        <h1 className={pageH1}>{tenant.name}</h1>

        {syntheticOnly && (
          <p role="note" className={warnBox}>
            <strong>Synthetic data only.</strong> This workspace does not accept real contact details yet. Use an e-mail address on a
            reserved domain (such as <code>example.test</code>) and a phone number that starts with <code>+00</code>. The operator
            opens this once the privacy checks are done.
          </p>
        )}

        {/* The set-up checklist of the business-setup plan (12.1) goes here: owners and admins only, until done. Its own ticket: until it ships this slot draws nothing. */}


      <nav aria-label="Records" className={tabRow}>
        {ENTITY_KEYS.map((key) => (
          <Link
            key={key}
            href={`/app/tenants/${tenantId}?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={`${tabLink} ${key === tab ? tabLinkOn : ""}`}
          >
            {LABELS[key]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="records-heading">
        <h2 id="records-heading" className={pageH2}>
          {LABELS[tab]}
        </h2>
        {page === null ? (
          <ApiDown />
        ) : page.items.length === 0 ? (
          <p className={bodyText}>
            {cursor
              ? "No more records."
              : `No ${LABELS[tab].toLowerCase()} yet.`}
          </p>
        ) : (
          <RecordsTable page={page} tenantId={tenantId} />
        )}
        {page?.nextCursor && (
          <p className={spaceTop}>
            <Link
              href={`/app/tenants/${tenantId}?tab=${tab}&cursor=${encodeURIComponent(page.nextCursor)}`}
              rel="next"
              className={link}
            >
              Load more
            </Link>
          </p>
        )}
        {cursor && (
          <p>
            <Link href={`/app/tenants/${tenantId}?tab=${tab}`} className={link}>
              Back to the first page
            </Link>
          </p>
        )}
      </section>

      {canWrite && (
        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className={pageH2}>
            Create a company
          </h2>
          <CreateCompanyForm
            action={createCompanyAction.bind(null, tenantId)}
            formId={formId}
          />
        </section>
      )}
      </main>
  );
}

function ApiDown() {
  return (
    <p role="alert" className={alertBox}>
      Could not load this from the API. Try again shortly.
    </p>
  );
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function RecordsTable({ page, tenantId }: { page: CrmPage; tenantId: string }) {
  switch (page.entity) {
    case "companies":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>Name</th>
              <th className={dataThCol}>Type</th>
              <th className={dataThCol}>Website</th>
              <th className={dataThCol}>Country</th>
              <th className={dataThCol}>City</th>
              <th className={dataThCol}>Industry</th>
              <th className={dataThCol}>Created</th>
              <th className={dataThCol}>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id} className={dataTr}>
                <td data-label="Name" className={dataTd}>
                  <Link
                    href={`/app/tenants/${tenantId}/companies/${encodeURIComponent(c.id)}`}
                    className={inlineLink}
                  >
                    {c.name}
                  </Link>
                </td>
                <td data-label="Type" className={dataTd}>{c.type}</td>
                <td data-label="Website" className={dataTd}>{c.website ?? "—"}</td>
                <td data-label="Country" className={dataTd}>{c.country ?? "—"}</td>
                <td data-label="City" className={dataTd}>{c.city ?? "—"}</td>
                <td data-label="Industry" className={dataTd}>{c.industry ?? "—"}</td>
                <td data-label="Created" className={dataTd}>{day(c.created_at)}</td>
                <td data-label="Origin" className={dataTd}>{c.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "contacts":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>Name</th>
              <th className={dataThCol}>Email</th>
              <th className={dataThCol}>Phone</th>
              <th className={dataThCol}>Job title</th>
              <th className={dataThCol}>Email consent</th>
              <th className={dataThCol}>Phone consent</th>
              <th className={dataThCol}>Suppressed</th>
              <th className={dataThCol}>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id} className={dataTr}>
                <td data-label="Name" className={dataTd}>{c.full_name}</td>
                <td data-label="Email" className={dataTd}>{c.email ?? "—"}</td>
                <td data-label="Phone" className={dataTd}>{c.phone ?? "—"}</td>
                <td data-label="Job title" className={dataTd}>{c.job_title ?? "—"}</td>
                <td data-label="Email consent" className={dataTd}>{c.email_consent}</td>
                <td data-label="Phone consent" className={dataTd}>{c.phone_consent}</td>
                <td data-label="Suppressed" className={dataTd}>{c.suppression_reason ?? "no"}</td>
                <td data-label="Origin" className={dataTd}>{c.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "products":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>SKU</th>
              <th className={dataThCol}>Name</th>
              <th className={dataThCol}>Unit</th>
              <th className={dataThCol}>Category</th>
              <th className={dataThCol}>Active</th>
              <th className={dataThCol}>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <tr key={p.id} className={dataTr}>
                <td data-label="SKU" className={dataTd}>{p.sku}</td>
                <td data-label="Name" className={dataTd}>{p.name}</td>
                <td data-label="Unit" className={dataTd}>{p.unit ?? "—"}</td>
                <td data-label="Category" className={dataTd}>{p.category ?? "—"}</td>
                <td data-label="Active" className={dataTd}>{p.active ? "yes" : "no"}</td>
                <td data-label="Origin" className={dataTd}>{p.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "leads":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>Status</th>
              <th className={dataThCol}>Source</th>
              <th className={dataThCol}>Created</th>
              <th className={dataThCol}>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((l) => (
              <tr key={l.id} className={dataTr}>
                <td data-label="Status" className={dataTd}>
                  <Link
                    href={`/app/tenants/${tenantId}/leads/${encodeURIComponent(l.id)}`}
                    className={inlineLink}
                  >
                    {l.status}
                  </Link>
                </td>
                <td data-label="Source" className={dataTd}>{l.source ?? "—"}</td>
                <td data-label="Created" className={dataTd}>{day(l.created_at)}</td>
                <td data-label="Origin" className={dataTd}>{l.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "opportunities":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>Title</th>
              <th className={dataThCol}>Status</th>
              <th className={dataThCol}>Closed</th>
              <th className={dataThCol}>Created</th>
              <th className={dataThCol}>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((o) => (
              <tr key={o.id} className={dataTr}>
                <td data-label="Title" className={dataTd}>{o.title}</td>
                <td data-label="Status" className={dataTd}>{o.status}</td>
                <td data-label="Closed" className={dataTd}>{o.closed_at ? day(o.closed_at) : "—"}</td>
                <td data-label="Created" className={dataTd}>{day(o.created_at)}</td>
                <td data-label="Origin" className={dataTd}>{o.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
