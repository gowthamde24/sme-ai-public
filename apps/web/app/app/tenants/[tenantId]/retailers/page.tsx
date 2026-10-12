import { notFound, redirect } from "next/navigation";

import { PageTop, NotShownV2, ApiDownV2 } from "@/components/v2/app/parts";
import { RetailersSearch, type SearchStatus } from "@/components/v2/app/retailers/RetailersSearch";
import { WRITERS } from "@/components/v2/app/nav";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getResearchStatus } from "@/lib/api/retailers";
import { requireUser } from "@/lib/auth/session";

import { confirmPlaceAction } from "./actions";

export const metadata = { title: "Find retailers · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/retailers (job CC): search Google Maps for shops and wholesalers through the official Places service, see the cards, keep the good ones as leads. For the Owner, Admin and Sales. Whether the map search
 * is switched on (and today's use) is the Owner's and Admin's to read; for a salesperson the page says it cannot tell and lets the search speak for itself.
 */
export default async function RetailersPage({ params }: PageProps<"/app/tenants/[tenantId]/retailers">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("rtl.title")} message={t("rtl.viewer")} />;
  let status: SearchStatus = "unknown";
  if (tenant.role !== "sales") {
    try {
      const s = await getResearchStatus(user.accessToken, tenantId);
      status = { enabled: s.find_retailers.enabled, used: s.find_retailers.used_today, limit: s.find_retailers.daily_limit };
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      // anything else: the page says it cannot tell
    }
  }
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("rtl.title")} sub={t("rtl.sub")} />
      <div className="mt-6 max-w-3xl">
        <RetailersSearch tenantId={tenantId} words={wordsFor(lang, ["rtl.", "apierr.", "problem."], ["dta.btn.working"])} status={status} confirm={confirmPlaceAction.bind(null, tenantId)} />
      </div>
    </main>
  );
}
