import { notFound, redirect } from "next/navigation";

import { PackReport } from "@/components/v2/app/reports/PackReports";
import { ReportNoAccess } from "@/components/v2/app/report/ReportView";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getReportCatalogue, runReport } from "@/lib/api/reports";
import { clock } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";

import { reportWords } from "../report-words";
import { packReportWords } from "../pack-report-words";

export const metadata = { title: "Report · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /app/tenants/[tenantId]/report/[code]: one report of the business type (job CU), from the one reports API. The code must be in the catalogue the API offers THIS business (the modules it has on), so an address for a report of another
 * business type is the same "not found" as any other. `?from=` and `?to=` are India days. Owner and Admin read (the weekly page's rule); the API decides what it answers.
 */
export default async function PackReportPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/report/[code]">) {
  const user = await requireUser();
  const { tenantId, code } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(tenantId) || !/^[a-z]+\.[a-z_]+$/.test(code) || code === "weekly.summary") notFound();
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
  if (tenant.role !== "owner" && tenant.role !== "admin") return <main className={pageMain} lang={lang}><ReportNoAccess labels={reportWords(lang)} /></main>;
  const base = `/app/tenants/${tenantId}`;
  const fromRaw = pick(raw.from);
  const toRaw = pick(raw.to);
  const from = fromRaw && DAY.test(fromRaw) ? fromRaw : null;
  const to = toRaw && DAY.test(toRaw) ? toRaw : null;
  let entry;
  let report = null;
  let problem = false;
  try {
    entry = (await getReportCatalogue(user.accessToken, tenantId)).items.find((i) => i.code === code);
    if (entry) {
      try {
        report = await runReport(user.accessToken, tenantId, code, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
      } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 422 || error.status === 400)) problem = true;
        else throw error;
      }
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  if (!entry) notFound();
  return (
    <main className={pageMain} lang={lang}>
      <PackReport base={base} words={packReportWords(lang)} code={code} window={entry.window} report={report} from={from} to={to} today={todayInIndia(clock())} problem={problem} />
    </main>
  );
}
