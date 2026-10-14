import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { indiaDayText } from "@/components/v2/app/visits/dates";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import {
  type CrmPage,
  ENTITY_KEYS,
  type EntityKey,
  fetchPage,
  isCanonicalUuid,
} from "@/lib/api/crm";
import { fetchDataPolicy } from "@/lib/api/erasure";
import { AddButton } from "@/components/v2/app/AddButton";
import { PageTop, SectionTabs } from "@/components/v2/app/parts";
import { alertBox, bodyText, btnQuiet, dataTable, dataTd, dataThCol, dataThSecondary, dataTdSecondary, dataTr, inlineLink, link, pageH2, pageMain, spaceTop, warnBox } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { createCompanyAction } from "./actions";
import { TodayScreen } from "./today-screen";
import { CreateCompanyForm } from "./create-company-form";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Workspace · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

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
  const lang = await getLang();
  const words = wordsFor(lang, ["ws."]);
  const t = makeT(words);
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
      <ApiDown words={words} />
    );
  }

  const requestedTab = pick(query.tab);
  // no tab: Today (Job AC, C2). The records tables are reached with ?tab= (Customers: companies and contacts; Leads: leads).
  if (requestedTab === undefined) return TodayScreen({ accessToken: user.accessToken, userId: user.id, tenantId, role: tenant.role, shop: tenant.name, example: pick(query.example) ?? null });
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
    <main className={pageMain} lang={lang}>
        <PageTop title={t(`ws.title.${tab}`)} sub={tab === "leads" ? t("ws.every_lead_of_the_workspace_as") : t("ws.records_of", { name: tenant.name })} />

        {syntheticOnly && (
          <p role="note" className={warnBox}>
            <strong>{t("ws.synthetic_data_only")}</strong> <Rich t={t} k="ws.synthetic_body" with={{ domain: <code>example.test</code>, prefix: <code>+00</code> }} />
          </p>
        )}

        {/* The set-up checklist of the business-setup plan (12.1) goes here: owners and admins only, until done. Its own ticket: until it ships this slot draws nothing. */}


      <SectionTabs label={t("ws.records")} items={ENTITY_KEYS.map((key) => ({ key, label: t(`ws.tab.${key}`), href: `/app/tenants/${tenantId}?tab=${key}`, current: key === tab }))} />

      {canWrite && (
        <section aria-label={t("ws.add_a_company")} className={`${spaceTop} flex flex-wrap items-start gap-3`}>
          {tab === "companies" || tab === "contacts" ? (
            <Link href={`/app/tenants/${tenantId}/customers/new`} className={btnQuiet}>
              {t("ws.add_a_customer")}
            </Link>
          ) : null}
          <AddButton label={t("ws.add_a_company")}>
            <CreateCompanyForm words={words}
              action={createCompanyAction.bind(null, tenantId)}
              formId={formId}
            />
          </AddButton>
        </section>
      )}

      <section aria-labelledby="records-heading">
        <h2 id="records-heading" className={pageH2}>
          {t(`ws.tab.${tab}`)}
        </h2>
        {page === null ? (
          <ApiDown words={words} />
        ) : page.items.length === 0 ? (
          <p className={bodyText}>
            {cursor
              ? t("ws.no_more_records")
              : t(`ws.none_yet.${tab}`)}
          </p>
        ) : (
          <RecordsTable words={words} page={page} tenantId={tenantId} />
        )}
        {page?.nextCursor && (
          <p className={spaceTop}>
            <Link
              href={`/app/tenants/${tenantId}?tab=${tab}&cursor=${encodeURIComponent(page.nextCursor)}`}
              rel="next"
              className={link}
            >
              {t("ws.load_more")}
            </Link>
          </p>
        )}
        {cursor && (
          <p>
            <Link href={`/app/tenants/${tenantId}?tab=${tab}`} className={link}>
              {t("ws.back_to_the_first_page")}
            </Link>
          </p>
        )}
      </section>

      </main>
  );
}

function ApiDown({ words }: { words?: Words }) {
  const t = makeT(words);
  return (
    <p role="alert" className={alertBox}>
      {t("ws.could_not_load_this_from_the")}
    </p>
  );
}

function day(iso: string): string {
  return indiaDayText(iso);
}

function RecordsTable({ page, tenantId, words }: { page: CrmPage; tenantId: string; words?: Words; }) {
  const t = makeT(words);
  switch (page.entity) {
    case "companies":
      return (
        <table className={dataTable}>
          <thead>
            <tr>
              <th className={dataThCol}>{t("ws.name")}</th>
              <th className={dataThCol}>{t("ws.type")}</th>
              <th className={dataThSecondary}>{t("ws.website")}</th>
              <th className={dataThSecondary}>{t("ws.country")}</th>
              <th className={dataThCol}>{t("ws.city")}</th>
              <th className={dataThSecondary}>{t("ws.industry")}</th>
              <th className={dataThSecondary}>{t("ws.created")}</th>
              <th className={dataThSecondary}>{t("ws.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id} className={dataTr}>
                <td data-label={t("ws.col_name")} className={dataTd}>
                  <Link
                    href={`/app/tenants/${tenantId}/companies/${encodeURIComponent(c.id)}`}
                    className={inlineLink}
                  >
                    {c.name}
                  </Link>
                </td>
                <td data-label={t("ws.col_type")} className={dataTd}>{c.type}</td>
                <td data-label={t("ws.col_website")} className={dataTdSecondary}>{c.website ?? "—"}</td>
                <td data-label={t("ws.col_country")} className={dataTdSecondary}>{c.country ?? "—"}</td>
                <td data-label={t("ws.col_city")} className={dataTd}>{c.city ?? "—"}</td>
                <td data-label={t("ws.col_industry")} className={dataTdSecondary}>{c.industry ?? "—"}</td>
                <td data-label={t("ws.col_created")} className={dataTdSecondary}>{day(c.created_at)}</td>
                <td data-label={t("ws.col_origin")} className={dataTdSecondary}>{c.created_via}</td>
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
              <th className={dataThCol}>{t("ws.name")}</th>
              <th className={dataThSecondary}>{t("ws.email")}</th>
              <th className={dataThCol}>{t("ws.phone")}</th>
              <th className={dataThSecondary}>{t("ws.job_title")}</th>
              <th className={dataThSecondary}>{t("ws.email_consent")}</th>
              <th className={dataThCol}>{t("ws.phone_consent")}</th>
              <th className={dataThSecondary}>{t("ws.suppressed")}</th>
              <th className={dataThSecondary}>{t("ws.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id} className={dataTr}>
                <td data-label={t("ws.col_name")} className={dataTd}>{c.full_name}</td>
                <td data-label={t("ws.col_email")} className={dataTdSecondary}>{c.email ?? "—"}</td>
                <td data-label={t("ws.col_phone")} className={dataTd}>{c.phone ?? "—"}</td>
                <td data-label={t("ws.col_job_title")} className={dataTdSecondary}>{c.job_title ?? "—"}</td>
                <td data-label={t("ws.col_email_consent")} className={dataTdSecondary}>{c.email_consent}</td>
                <td data-label={t("ws.col_phone_consent")} className={dataTd}>{c.phone_consent}</td>
                <td data-label={t("ws.col_suppressed")} className={dataTdSecondary}>{c.suppression_reason ?? "no"}</td>
                <td data-label={t("ws.col_origin")} className={dataTdSecondary}>{c.created_via}</td>
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
              <th className={dataThCol}>{t("ws.sku")}</th>
              <th className={dataThCol}>{t("ws.name")}</th>
              <th className={dataThCol}>{t("ws.unit")}</th>
              <th className={dataThCol}>{t("ws.category")}</th>
              <th className={dataThCol}>{t("ws.active")}</th>
              <th className={dataThCol}>{t("ws.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <tr key={p.id} className={dataTr}>
                <td data-label={t("ws.col_sku")} className={dataTd}>{p.sku}</td>
                <td data-label={t("ws.col_name")} className={dataTd}>{p.name}</td>
                <td data-label={t("ws.col_unit")} className={dataTd}>{p.unit ?? "—"}</td>
                <td data-label={t("ws.col_category")} className={dataTd}>{p.category ?? "—"}</td>
                <td data-label={t("ws.col_active")} className={dataTd}>{p.active ? "yes" : "no"}</td>
                <td data-label={t("ws.col_origin")} className={dataTd}>{p.created_via}</td>
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
              <th className={dataThCol}>{t("ws.status")}</th>
              <th className={dataThCol}>{t("ws.source")}</th>
              <th className={dataThCol}>{t("ws.created")}</th>
              <th className={dataThCol}>{t("ws.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((l) => (
              <tr key={l.id} className={dataTr}>
                <td data-label={t("ws.col_status")} className={dataTd}>
                  <Link
                    href={`/app/tenants/${tenantId}/leads/${encodeURIComponent(l.id)}`}
                    className={inlineLink}
                  >
                    {l.status}
                  </Link>
                </td>
                <td data-label={t("ws.col_source")} className={dataTd}>{l.source ?? "—"}</td>
                <td data-label={t("ws.col_created")} className={dataTd}>{day(l.created_at)}</td>
                <td data-label={t("ws.col_origin")} className={dataTd}>{l.created_via}</td>
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
              <th className={dataThCol}>{t("ws.title")}</th>
              <th className={dataThCol}>{t("ws.status")}</th>
              <th className={dataThCol}>{t("ws.closed")}</th>
              <th className={dataThCol}>{t("ws.created")}</th>
              <th className={dataThCol}>{t("ws.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((o) => (
              <tr key={o.id} className={dataTr}>
                <td data-label={t("ws.col_title")} className={dataTd}>{o.title}</td>
                <td data-label={t("ws.col_status")} className={dataTd}>{o.status}</td>
                <td data-label={t("ws.col_closed")} className={dataTd}>{o.closed_at ? day(o.closed_at) : "—"}</td>
                <td data-label={t("ws.col_created")} className={dataTd}>{day(o.created_at)}</td>
                <td data-label={t("ws.col_origin")} className={dataTd}>{o.created_via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
