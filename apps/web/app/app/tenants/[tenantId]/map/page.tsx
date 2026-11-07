import { notFound, redirect } from "next/navigation";

import { CustomerMap } from "@/components/v2/app/map/CustomerMap";
import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchPage, isCanonicalUuid, type CompanyRow } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { listSites } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";
import type { DeskLead } from "@/lib/lead-desk/leads";
import { readDeskLeads } from "@/lib/lead-desk/leads-source";
import { groupPlaces } from "@/lib/map/places";
import { appV4, leadsScreens } from "@/lib/screens/flag";

export const metadata = { title: `Map · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const PAGES = 4; // up to 100 customers: more than a list of places can hold usefully

/**
 * /app/tenants/[tenantId]/map (app v4 part 5; only with APP_V4, else 404): Customers > Map, where the customers are, as a list of real places (owner's rule: only addresses that were given, nothing looked up or paid for). The customers are
 * Lead Desk's leads that gave a city; the sites are the customers' own sites with an address (a business type that has them). A part that cannot be read says so. Every role that reads the workspace may open it.
 */
export default async function MapPage({ params }: PageProps<"/app/tenants/[tenantId]/map">) {
  if (!appV4()) notFound();
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const ctx = { token: user.accessToken, tenantId, userId: user.id };
  const leads: DeskLead[] = [];
  let leadsRead = true;
  try {
    let cursor: string | null = null;
    for (let i = 0; i < PAGES; i++) {
      const page = await readDeskLeads(ctx, null, cursor);
      if (page === null) {
        // Lead Desk is off (no customers to list: not an error) or its list cannot be read (said)
        leadsRead = leadsScreens() === "off";
        break;
      }
      leads.push(...page.leads);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    leadsRead = false;
  }
  // the CRM's own customers (companies of type customer): the first pages, a part that cannot be read is said
  const companies: CompanyRow[] = [];
  let companiesRead = true;
  try {
    let cursor: string | null = null;
    for (let i = 0; i < PAGES; i++) {
      const page = await fetchPage(user.accessToken, tenantId, "companies", cursor);
      if (page.entity !== "companies") break;
      companies.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    companiesRead = false;
  }
  const sites = await listSites(user.accessToken, tenantId, { limit: 100 }).then(
    (p) => ({ items: p.items, ok: true }),
    (error) => {
      if (error instanceof ApiAuthError) redirect("/login");
      // a business type without sites answers 403/404: not an error, just none
      return { items: [], ok: error instanceof ApiRequestError && (error.status === 403 || error.status === 404) };
    },
  );
  const lang = await getLang();
  const w = wordsFor(lang, ["map.", "nav.item.m-map"]);
  const grouped = groupPlaces(leads, sites.items, `/app/tenants/${tenantId}`, companies);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={w["nav.item.m-map"]} sub={w["map.sub"]} />
      <div className="mt-4">
        <CustomerMap {...grouped} w={w} unread={{ customers: !leadsRead || !companiesRead, sites: !sites.ok }} />
      </div>
    </main>
  );
}
