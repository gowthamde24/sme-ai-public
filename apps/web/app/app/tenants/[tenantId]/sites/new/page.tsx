import { randomUUID } from "node:crypto";

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
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";

import { saveSiteAction, searchCompaniesAction } from "../site-actions";
import { siteWords } from "../site-words";

export const metadata = { title: "Add a site · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/sites/new: add a delivery site (Owner, Admin, Sales; a Viewer goes back to the list). `?company=` picks the customer already. The page makes the site's id, so pressing Save twice is a retry. */
export default async function NewSitePage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/sites/new">) {
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
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer") redirect(`${base}/sites`);
  const lang = await getLang();
  const t = appT(lang);
  const wanted = pick(raw.company);
  let company = null;
  if (wanted && isCanonicalUuid(wanted)) {
    try {
      const c = await fetchCompany(user.accessToken, tenantId, wanted);
      company = { id: c.id, name: c.name, city: c.city ?? null };
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
    }
  }
  const actions: SiteActions = { save: saveSiteAction.bind(null, tenantId, null), search: searchCompaniesAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/sites`} className={backLink}>← {t("nav.item.sites")}</Link></p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{t("site.add")}</h1>
      <SiteForm base={base} siteId={randomUUID()} site={null} company={company} contactLabel={null} words={siteWords(lang)} actions={actions} />
    </main>
  );
}
