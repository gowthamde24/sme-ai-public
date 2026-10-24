import { notFound, redirect } from "next/navigation";

import { ApiDownV2, BackLink, SectionTabs } from "@/components/v2/app/parts";
import { pageH1, pageMain } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchEnquiry, fetchRequirement } from "@/lib/api/enquiries";
import { escalate } from "@/lib/api/failure";
import { take } from "@/lib/api/settled";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { MaterialQuoteSection } from "../../material-quote-section";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Quote · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/enquiries/[enquiryId]/quote: making a quote from an enquiry whose requirement a person has approved (job CO; module `materials`). It is a route of its own so the enquiry page of a saree
 * workspace does not carry the builder. Owner, Admin and Sales; a Viewer is sent back to the enquiry.
 */
export default async function MaterialQuoteRoute({ params }: PageProps<"/app/tenants/[tenantId]/enquiries/[enquiryId]/quote">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["enq.", "mat.", "today.err.", "today.lang."], ["today.act.working", "today.act.cancel", "site.customer.unknown", "frame.notyet", "nav.item.quotes", "nav.item.sites", "catalogue.photo.none"]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId, enquiryId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) notFound();
  let tenant;
  let enquiry;
  let view;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
    const [enquiryRead, requirementRead] = await Promise.allSettled([fetchEnquiry(user.accessToken, tenantId, enquiryId), fetchRequirement(user.accessToken, tenantId, enquiryId)]);
    enquiry = take(enquiryRead);
    view = take(requirementRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) notFound();
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  if (tenant.role === "viewer") redirect(base);
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/quotes`} label={t("enq.all_quotes")} then={{ href: `/app/tenants/${tenantId}/leads/${enquiry.lead_id}`, label: t("enq.the_lead") }} />
      <h1 className={pageH1}>{t("enq.enquiry")}</h1>
      <SectionTabs label={t("enq.parts_of_this_enquiry")} items={[{ key: "request", label: t("enq.part.request"), href: base, current: false }, { key: "quote", label: t("mat.part.quote"), href: `${base}/quote`, current: true }]} />
      {await MaterialQuoteSection({ accessToken: user.accessToken, tenantId, enquiry, view, role: tenant.role, words, newQuoteId: crypto.randomUUID() })}
    </main>
  );
}
