import { notFound, redirect } from "next/navigation";

import { NotShownV2, ApiDownV2 } from "@/components/v2/app/parts";
import { QuoteDetailView } from "@/components/v2/app/materials/QuoteDetailView";
import { pageMain } from "@/components/v2/app/ui";
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

import { readLeadLabel } from "../../visits/visits-data";
import { approveMaterialQuoteAction, materialQuoteTextAction, orderFromMaterialQuoteAction, rejectMaterialQuoteAction } from "../material-actions";
import { quoteWords } from "../material-words";
import { BRAND_NAME } from "@/design/brand";
import { secondFactorNeeded } from "@/lib/auth/second-factor";

export const metadata = { title: `Quote · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/quotes/[quoteId]: one building-materials quote (job CO; module `materials`, which the module guard of the workspace checks through the Quotes entry). Owner, Admin and Sales read it and
 * turn it down; Owner and Admin approve it (second factor; a flagged quote the Owner alone) and make the order. A Viewer reads no money. Nothing here sends a message to anyone.
 */
export default async function MaterialQuotePage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/quotes/[quoteId]">) {
  const user = await requireUser();
  const { tenantId, quoteId } = await params;
  const raw = await searchParams;
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
  // this page is the building-materials quote (module `materials`); a business of another kind has no such address
  if (!hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) notFound();
  const lang = await getLang();
  const words = quoteWords(lang);
  if (tenant.role === "viewer") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={words["nav.item.quotes"] ?? "Quotes"} message={words["mat.q.viewer"] ?? ""} />;
  let quote;
  try {
    quote = await getMaterialQuote(user.accessToken, tenantId, quoteId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const [lead, site] = await Promise.all([
    readLeadLabel(user.accessToken, tenantId, quote.lead_id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)),
    quote.site_id ? getSite(user.accessToken, tenantId, quote.site_id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : Promise.resolve(null),
  ]);
  const actions = {
    approve: approveMaterialQuoteAction.bind(null, tenantId, quoteId),
    reject: rejectMaterialQuoteAction.bind(null, tenantId, quoteId),
    order: orderFromMaterialQuoteAction.bind(null, tenantId, quoteId),
    text: materialQuoteTextAction.bind(null, tenantId, quoteId),
  };
  return (
    <main className={pageMain} lang={lang}>
      <QuoteDetailView base={`/app/tenants/${tenantId}`} words={words} role={tenant.role} quote={quote} customer={lead?.label ?? null} site={site ? [site.name, site.city].filter(Boolean).join(", ") : null} actions={actions} secondFactorMissing={secondFactorNeeded(user)} made={pick(raw.made) === "1"} />
    </main>
  );
}
