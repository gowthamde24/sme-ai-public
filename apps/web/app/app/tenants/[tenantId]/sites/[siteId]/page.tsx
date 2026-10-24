import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SiteForm } from "@/components/v2/app/sites/SiteForm";
import type { SiteActions } from "@/components/v2/app/sites/sites-types";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, fetchContact, isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getSite } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";

import { saveSiteAction, searchCompaniesAction } from "../site-actions";
import { siteWords } from "../site-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Site · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/sites/[siteId]: change a site (Owner, Admin, Sales). A Viewer is sent back to the list: the list already shows everything a site holds. */
export default async function SitePage({ params }: PageProps<"/app/tenants/[tenantId]/sites/[siteId]">) {
  const user = await requireUser();
  const { tenantId, siteId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(siteId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer") redirect(`${base}/sites`);
  let site;
  try {
    site = await getSite(user.accessToken, tenantId, siteId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  let company = null;
  let contactLabel: string | null = null;
  try {
    const c = await fetchCompany(user.accessToken, tenantId, site.company_id);
    company = { id: c.id, name: c.name, city: c.city ?? null };
    if (site.site_contact_id) contactLabel = (await fetchContact(user.accessToken, tenantId, site.site_contact_id)).full_name;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  const actions: SiteActions = { save: saveSiteAction.bind(null, tenantId, site.site_contact_id), search: searchCompaniesAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/sites`} className={backLink}>← {t("nav.item.sites")}</Link></p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{t("site.edit.title", { name: site.name })}</h1>
      <SiteForm base={base} siteId={site.id} site={site} company={company ?? { id: site.company_id, name: "", city: null }} contactLabel={contactLabel} words={siteWords(lang)} actions={actions} />
    </main>
  );
}
