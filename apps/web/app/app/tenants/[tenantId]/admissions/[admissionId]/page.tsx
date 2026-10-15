import { notFound, redirect } from "next/navigation";

import { AdmissionDetail } from "@/components/v2/app/education/AdmissionDetail";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getAdmission, listFeePlans, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { clock } from "@/lib/clock";
import { hasModule } from "@/lib/packs/has";

import { eduContext, eduWords } from "../../education-kit";
import { admissionStageAction, admitAction } from "../actions";

export const metadata = { title: "Admission · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/admissions/[admissionId]: one enquiry with its history, the way forward, and (Owner, Admin) admit (job CS). */
export default async function AdmissionRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/admissions/[admissionId]">) {
  const { tenantId, admissionId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(admissionId)) notFound();
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant, pack } = got.ctx;
  const lang = await getLang();
  let admission;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  let plans: Awaited<ReturnType<typeof listFeePlans>> = [];
  try {
    [admission, programmes] = await Promise.all([getAdmission(accessToken, tenantId, admissionId), listProgrammes(accessToken, tenantId)]);
    if (hasModule(pack, "fees") && admission.stage === "application") plans = await listFeePlans(accessToken, tenantId).catch((e) => { if (e instanceof ApiAuthError) throw e; return []; });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <AdmissionDetail
        admission={admission}
        base={`/app/tenants/${tenantId}`}
        role={tenant.role}
        words={eduWords(lang)}
        programmes={programmes}
        plans={plans}
        saved={(Array.isArray(raw.saved) ? raw.saved[0] : raw.saved) === "1"}
        today={todayInIndia(clock())}
        actions={{ stage: admissionStageAction.bind(null, tenantId, admissionId), admit: admitAction.bind(null, tenantId, admissionId) }}
      />
    </main>
  );
}
