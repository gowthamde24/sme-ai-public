import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { QuotePrint } from "@/components/v2/app/materials/QuotePrint";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getMaterialQuote } from "@/lib/api/materials";
import { getSite } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { readLeadLabel } from "../../../visits/visits-data";
import { quoteWords } from "../../material-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Quotation · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/quotes/[quoteId]/print: the quotation as a page to print or save as PDF (job CO). Owner, Admin and Sales; a Viewer reads no money. */
export default async function MaterialQuotePrintPage({ params }: PageProps<"/app/tenants/[tenantId]/quotes/[quoteId]/print">) {
  const user = await requireUser();
  const { tenantId, quoteId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (tenant.role === "viewer" || !hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) notFound();
  let quote;
  try {
    quote = await getMaterialQuote(user.accessToken, tenantId, quoteId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const [lead, site] = await Promise.all([
    readLeadLabel(user.accessToken, tenantId, quote.lead_id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)),
    quote.site_id ? getSite(user.accessToken, tenantId, quote.site_id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : Promise.resolve(null),
  ]);
  return (
    <main lang={lang} className="px-2 py-4">
      <QuotePrint business={tenant.name} quote={quote} customer={lead?.label ?? null} site={site ? [site.name, site.address_line, site.city].filter(Boolean).join(", ") : null} words={quoteWords(lang)} />
    </main>
  );
}
