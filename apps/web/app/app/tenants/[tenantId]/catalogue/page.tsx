import { notFound, redirect } from "next/navigation";

import { CatalogueView } from "@/components/v2/app/catalogue/CatalogueView";
import { parseQuery } from "@/components/v2/app/catalogue/catalogue-logic";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { rawQuery } from "@/lib/packs/materials-redirect";
import { readPackCached } from "@/lib/packs/read";

import { readLeadLabel } from "../visits/visits-data";
import { readCatalogue } from "./catalogue-data";
import { catalogueWords } from "./catalogue-words";
import { partsWords } from "@/i18n/app-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Catalogue · ${BRAND_NAME}` };
// Per-user data from the API (and links that run out): never statically rendered or cached.
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/**
 * /app/tenants/[tenantId]/catalogue: the saree photo catalogue (job BC). Every member reads it: a photo grid with search and filter chips; Owner and Admin also see the hidden sarees (greyed) and can add one. `?lead=`
 * is the customer a saree is being chosen for (from the lead's page); it is carried to the saree's page. Server side: requireUser() runs first and every call goes to OUR API with the person's own token.
 */
export default async function CataloguePage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/catalogue">) {
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
  // a business that sells by area, weight or piece (module `materials`, job CO) sees its products here, not the saree photo catalogue
  if (hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) redirect(`/app/tenants/${tenantId}/materials${rawQuery(raw)}`);
  const lang = await getLang();
  const query = parseQuery(raw);
  const rawAfter = pick(raw.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  const admin = tenant.role === "owner" || tenant.role === "admin";
  const leadParam = pick(raw.lead);
  let data;
  let lead = null;
  try {
    [data, lead] = await Promise.all([readCatalogue(user.accessToken, tenantId, query, admin, after), leadParam && tenant.role !== "viewer" ? readLeadLabel(user.accessToken, tenantId, leadParam) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <CatalogueView help={helpTipFor(lang, `/app/tenants/${tenantId}`, "catalogue")} base={`/app/tenants/${tenantId}`} words={catalogueWords(lang)} role={tenant.role} query={query} items={data.items} more={data.more} lead={lead} />
    </main>
  );
}
