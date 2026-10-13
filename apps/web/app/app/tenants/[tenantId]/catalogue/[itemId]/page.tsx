import { notFound, redirect } from "next/navigation";

import { ItemView } from "@/components/v2/app/catalogue/ItemView";
import type { SendActions } from "@/components/v2/app/catalogue/catalogue-types";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { getCatalogueItem } from "@/lib/api/catalogue";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { take } from "@/lib/api/settled";
import { requireUser } from "@/lib/auth/session";

import { readLeadLabel } from "../../visits/visits-data";
import { searchLeadsAction, sendCatalogueAction } from "../catalogue-actions";
import { catalogueWords } from "../catalogue-words";
import { partsWords } from "@/i18n/app-words";

export const metadata = { title: "Catalogue · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/catalogue/[itemId]: one saree (job BC): the big photos, the details, and for Owner, Admin and Sales "Send to a customer". `?lead=` picks the customer already; `?saved=1` says the
 * saree was just saved. A saree that does not exist, or that this person may not see (a hidden one, for Sales and Viewer), is a plain "not found".
 */
export default async function CatalogueItemPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/catalogue/[itemId]">) {
  const user = await requireUser();
  const { tenantId, itemId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  // the saree and (for a role that may send it) the customer it is being chosen for are asked at the same time (job CH): the role is known from the workspace read above
  const leadParam = pick(raw.lead);
  const writer = tenant.role !== "viewer";
  const [itemRead, leadRead] = await Promise.allSettled([getCatalogueItem(user.accessToken, tenantId, itemId), writer && leadParam ? readLeadLabel(user.accessToken, tenantId, leadParam) : Promise.resolve(null)]);
  let item;
  try {
    item = take(itemRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const admin = tenant.role === "owner" || tenant.role === "admin";
  // a hidden saree is for the owner and admins only
  if (!item.active && !admin) notFound();
  const lang = await getLang();
  let lead = null;
  try {
    lead = take(leadRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const send: SendActions | null = writer ? { search: searchLeadsAction.bind(null, tenantId), send: sendCatalogueAction.bind(null, tenantId) } : null;
  return (
    <main className={pageMain} lang={lang}>
      <ItemView base={`/app/tenants/${tenantId}`} item={item} role={tenant.role} words={catalogueWords(lang)} lead={lead} saved={pick(raw.saved) === "1"} send={send} />
    </main>
  );
}
