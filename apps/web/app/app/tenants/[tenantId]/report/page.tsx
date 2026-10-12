import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { ReportNoAccess, ReportView } from "@/components/v2/app/report/ReportView";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { readReport } from "./report-data";
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
  const labels = reportWords(lang);
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
  return (
    <main className={pageMain} lang={lang}>
      <ReportView data={data} labels={labels} lang={lang} />
    </main>
  );
}
