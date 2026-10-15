import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { ReportNoAccess, ReportView } from "@/components/v2/app/report/ReportView";
import { PackReportsList } from "@/components/v2/app/reports/PackReports";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getReportCatalogue } from "@/lib/api/reports";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { withModuleWords } from "@/lib/packs/module-words";
import { readPackCached } from "@/lib/packs/read";

import { readReport } from "./report-data";
import { packReportWords } from "./pack-report-words";
import { reportWords } from "./report-words";

export const metadata = { title: "This week · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["owner", "admin"];

/** The moment the page is drawn (ms): read here, once, so the week and the figures agree. */
const clock = (): number => Date.now();

/**
 * /app/tenants/[tenantId]/report: "This week" (job BV), the owner's week at a glance: visits booked, came and bought, messages sent, waiting and blocked, how fast the person says OK, the sarees sent most and how much
 * of Agent OWL's weekly allowance is used. For the Owner and Admin (the AI figure is theirs alone; the API refuses anyone else). Server side: requireUser() runs first and every read goes to OUR API with the person's own token.
 */
export default async function ReportPage({ params }: PageProps<"/app/tenants/[tenantId]/report">) {
  const user = await requireUser();
  const { tenantId } = await params;
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
  const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
  const labels = withModuleWords(reportWords(lang), pack);
  if (!ADMIN_ROLES.includes(tenant.role)) {
    return (
      <main className={pageMain} lang={lang}>
        <ReportNoAccess labels={labels} />
      </main>
    );
  }
  let data;
  try {
    data = await readReport(user.accessToken, tenantId, clock());
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  // the reports of the business type (job CU), from the one reports API; a business that has only the weekly page (the saree shop) shows nothing more
  let entries: { code: string; window: "range" | "day" | "week" }[] = [];
  try {
    entries = (await getReportCatalogue(user.accessToken, tenantId)).items.filter((i) => i.code !== "weekly.summary").map((i) => ({ code: i.code, window: i.window }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <ReportView data={data} labels={labels} lang={lang} catalogue={hasModule(pack, "catalogue") || pack === null} more={<PackReportsList base={`/app/tenants/${tenantId}`} entries={entries} words={packReportWords(lang)} />} />
    </main>
  );
}
