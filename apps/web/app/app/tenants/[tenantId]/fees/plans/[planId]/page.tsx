import { notFound, redirect } from "next/navigation";

import { FeePlanDetail } from "@/components/v2/app/education/FeePlansView";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getFeePlan, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../../education-kit";

export const metadata = { title: "Fee plan · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/fees/plans/[planId]: one fee plan, read only (job CS). A plan someone holds cannot change: make a copy. */
export default async function FeePlanRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/fees/plans/[planId]">) {
  const { tenantId, planId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(planId)) notFound();
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
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
  return (
    <main className={pageMain} lang={lang}>
      <FeePlanDetail base={`/app/tenants/${tenantId}`} words={eduWords(lang)} role={tenant.role} plan={plan} programme={programmes.find((p) => p.id === plan.programme_id) ?? null} saved={(Array.isArray(raw.saved) ? raw.saved[0] : raw.saved) === "1"} />
    </main>
  );
}
