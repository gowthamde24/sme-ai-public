import { notFound, redirect } from "next/navigation";

import { FeePlanForm } from "@/components/v2/app/education/FeePlanForm";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getFeePlan, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../../../education-kit";
import { saveFeePlanAction } from "../../../actions";

export const metadata = { title: "Change a fee plan · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/fees/plans/[planId]/edit: change a fee plan nobody holds yet (job CS; Owner and Admin). A held plan goes back to its page: it cannot change, make a copy. */
export default async function EditFeePlanRoute({ params }: PageProps<"/app/tenants/[tenantId]/fees/plans/[planId]/edit">) {
  const { tenantId, planId } = await params;
  if (!isCanonicalUuid(planId)) notFound();
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/fees/plans/${planId}`);
  const lang = await getLang();
  let plan;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [plan, programmes] = await Promise.all([getFeePlan(accessToken, tenantId, planId), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  if (plan.assigned > 0) redirect(`${base}/fees/plans/${planId}`);
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{eduWords(lang)["edu.plan.save.edit"]}</h1>
      <FeePlanForm base={base} planId={planId} plan={plan} copy={false} programmes={programmes} defaultYear={plan.academic_year} words={eduWords(lang)} actions={{ save: saveFeePlanAction.bind(null, tenantId) }} />
    </main>
  );
}
