import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { SitesView } from "@/components/v2/app/sites/SitesView";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { listSites } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";

import { siteWords } from "./site-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Sites · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/**
 * /app/tenants/[tenantId]/sites: the delivery sites of the customers (job CO; module `sites`, which the module guard of the workspace checks). Every member reads; Owner, Admin and Sales add and change. Server side:
 * requireUser() runs first and every call goes to OUR API with the person's own token.
 */
export default async function SitesPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/sites">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const rawAfter = pick(raw.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  const admin = tenant.role === "owner" || tenant.role === "admin";
  let page: Awaited<ReturnType<typeof listSites>> | null = null;
  const names: Record<string, string> = {};
  try {
    page = await listSites(user.accessToken, tenantId, { includeInactive: admin, after });
    const ids = [...new Set(page.items.map((s) => s.company_id))].slice(0, 30);
    await Promise.all(ids.map(async (id) => { try { names[id] = (await fetchCompany(user.accessToken, tenantId, id)).name; } catch (e) { if (e instanceof ApiAuthError) throw e; } }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    page = null;
  }
  return (
    <main className={pageMain} lang={lang}>
      <SitesView base={`/app/tenants/${tenantId}`} words={siteWords(lang)} role={tenant.role} sites={page?.items ?? null} names={names} more={page?.next_cursor ?? null} saved={pick(raw.saved) === "1"} />
    </main>
  );
}
