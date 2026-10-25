import { notFound, redirect } from "next/navigation";

import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { BackLink } from "@/components/v2/app/parts";
import { PlanPicker } from "@/components/v2/app/plan/PlanPicker";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";
import { callsPlans, mainPlans } from "@/lib/plan/catalogue";
import { planScreens } from "@/lib/plan/flag";
import { readWorkspacePlan } from "@/lib/plan/source";

import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, startPlanAction } from "../plan-actions";

export const metadata = { title: `Plans · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/plans (job DK): the six plans side by side, and for an Owner or Admin with no plan the way to start the 30-day trial. A 404 while the feature flag is off (NEXT_PUBLIC_PLAN_SCREENS), like a page that
 * does not exist. Owner and Admin only: the plan and what it costs are theirs; everyone else gets the same 404.
 */
export default async function PlansPage({ params }: PageProps<"/app/tenants/[tenantId]/plans">) {
  if (planScreens() === "off") notFound();
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
  if (tenant.role !== "owner" && tenant.role !== "admin") notFound();
  const lang = await getLang();
  const t = appT(lang);
  const base = `/app/tenants/${tenantId}`;
  const plan = await readWorkspacePlan();
  const mock = planScreens() === "mock";
  const canStart = mock && (plan === null || plan.state === "none" || plan.state === "cancelled");
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`${base}/settings?section=plan`} label={t("plan.title")} />
      <PageTop title={t("plan.picker.title")} />
      <div className="mt-6">
        <PlanPicker
          words={wordsFor(lang, ["plan."])}
          main={mainPlans()}
          calls={callsPlans()}
          currentId={plan && plan.state !== "cancelled" ? plan.planId : null}
          canStart={canStart}
          mock={mock}
          done={`${base}/settings?section=plan`}
          actions={{ start: startPlanAction.bind(null, tenantId), cancel: cancelPlanAction.bind(null, tenantId), fix: fixPlanPaymentAction.bind(null, tenantId), endTrial: mock ? endPlanTrialAction.bind(null, tenantId) : null }}
        />
      </div>
    </main>
  );
}
