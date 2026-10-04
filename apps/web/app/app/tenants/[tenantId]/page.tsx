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
    return <ApiDown />;
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

  const canWrite = WRITE_ROLES.includes(tenant.role);
  const formId = crypto.randomUUID();

  return (
    <main className="shell wide">
      <p>
        <Link href="/app">← Workspaces</Link>
      </p>
      <h1>{tenant.name}</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>

      <nav aria-label="Lead actions" style={{ marginBottom: "1rem" }}>
        <Link
          href={`/app/tenants/${tenantId}/review`}
          style={{ fontWeight: 600 }}
        >
          Lead Review Queue →
        </Link>
        {" · "}
        <Link href={`/app/tenants/${tenantId}/agents`} style={{ fontWeight: 600 }}>
          Agents →
        </Link>
      </nav>

      <nav aria-label="Records" className="tabs">
        {ENTITY_KEYS.map((key) => (
          <Link
            key={key}
            href={`/app/tenants/${tenantId}?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
          >
            {LABELS[key]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="records-heading">
        <h2 id="records-heading">{LABELS[tab]}</h2>
        {page === null ? (
          <ApiDown />
        ) : page.items.length === 0 ? (
          <p>
            {cursor
              ? "No more records."
              : `No ${LABELS[tab].toLowerCase()} yet.`}
          </p>
        ) : (
          <RecordsTable page={page} tenantId={tenantId} />
        )}
        {page?.nextCursor && (
          <p>
            <Link
              href={`/app/tenants/${tenantId}?tab=${tab}&cursor=${encodeURIComponent(page.nextCursor)}`}
              rel="next"
            >
              Load more
            </Link>
          </p>
        )}
        {cursor && (
          <p>
            <Link href={`/app/tenants/${tenantId}?tab=${tab}`}>
              Back to the first page
            </Link>
          </p>
        )}
      </section>

      {canWrite && (
        <section aria-labelledby="create-heading">
          <h2 id="create-heading">Create a company</h2>
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
    <p role="alert" className="error">
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
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Website</th>
              <th>Country</th>
              <th>City</th>
              <th>Industry</th>
              <th>Created</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link
                    href={`/app/tenants/${tenantId}/companies/${encodeURIComponent(c.id)}`}
                  >
                    {c.name}
                  </Link>
                </td>
                <td>{c.type}</td>
                <td>{c.website ?? "—"}</td>
                <td>{c.country ?? "—"}</td>
                <td>{c.city ?? "—"}</td>
                <td>{c.industry ?? "—"}</td>
                <td>{day(c.created_at)}</td>
                <td>{c.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "contacts":
      return (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Job title</th>
              <th>Email consent</th>
              <th>Phone consent</th>
              <th>Suppressed</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>{c.job_title ?? "—"}</td>
                <td>{c.email_consent}</td>
                <td>{c.phone_consent}</td>
                <td>{c.suppression_reason ?? "no"}</td>
                <td>{c.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "products":
      return (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Unit</th>
              <th>Category</th>
              <th>Active</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.unit ?? "—"}</td>
                <td>{p.category ?? "—"}</td>
                <td>{p.active ? "yes" : "no"}</td>
                <td>{p.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "leads":
      return (
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Source</th>
              <th>Created</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link
                    href={`/app/tenants/${tenantId}/leads/${encodeURIComponent(l.id)}`}
                  >
                    {l.status}
                  </Link>
                </td>
                <td>{l.source ?? "—"}</td>
                <td>{day(l.created_at)}</td>
                <td>{l.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "opportunities":
      return (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Closed</th>
              <th>Created</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((o) => (
              <tr key={o.id}>
                <td>{o.title}</td>
                <td>{o.status}</td>
                <td>{o.closed_at ? day(o.closed_at) : "—"}</td>
                <td>{day(o.created_at)}</td>
                <td>{o.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
