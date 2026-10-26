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
import { FAKE_CHECKOUT } from "@/lib/plan/flag";
import { planScreens } from "@/lib/plan/flag";
import { readCatalogue, readWorkspacePlan } from "@/lib/plan/source";
import { topupScreens } from "@/lib/screens/flag";
import { readUsageCached } from "@/lib/topups/source";
import { WaitingCard } from "@/components/v2/app/topups/WaitingCard";

import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, resumePlanAction, startPlanAction } from "../plan-actions";

export const metadata = { title: `Plans · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/plans (job DK): the plans side by side (read from the plans data), and for the Owner of a workspace that has not had a plan the way to start the 30-day trial. A 404 while the feature flag is off (PLAN_SCREENS), like a page that
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
  const ctx = { token: user.accessToken, tenantId };
  const [catalogue, plan] = await Promise.all([readCatalogue(ctx), readWorkspacePlan(ctx)]);
  // "12 leads waiting for calls · Top up" (night 4, TOPUP_SCREENS): the calls wait for minutes, whatever plan the business looks at
  const waiting = topupScreens() === "off" ? 0 : ((await readUsageCached(user.accessToken, tenantId))?.queuedCalls ?? 0);
  const mock = planScreens() === "mock";
  const owner = tenant.role === "owner";
  // a lapsed plan has no new trial: the way back is to pay again (job DP; C1's POST /billing/resume)
  const resuming = owner && plan !== null && plan.canResume;
  const canStart = owner && plan !== null && (plan.canStartTrial || plan.canResume);
  const blocked = !owner ? "forbidden" : plan !== null && !plan.canStartTrial && !plan.canResume ? (plan.state === "cancelled" ? "used" : "already") : null;
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`${base}/settings?section=plan`} label={t("plan.title")} />
      <PageTop title={t("plan.picker.title")} />
      <div className="mt-6">
        <WaitingCard words={wordsFor(lang, ["tu.cta.", "tu.wait."])} waiting={waiting} href={`${base}/settings?section=plan#topups`} canBuy={tenant.role === "owner"} />
        {catalogue === null ? (
          <p className="text-sm text-muted">{t("frame.notyet")}</p>
        ) : (
          <PlanPicker
            words={wordsFor(lang, ["plan.", "tu.picker."])}
            main={mainPlans(catalogue)}
            calls={callsPlans(catalogue)}
            currentId={plan && plan.state !== "cancelled" ? plan.planId : null}
            canStart={canStart}
            resuming={resuming}
            blocked={blocked}
            mock={FAKE_CHECKOUT}
            trialDays={catalogue.trial.days}
            done={`${base}/settings?section=plan`}
            actions={{ start: (resuming ? resumePlanAction : startPlanAction).bind(null, tenantId), cancel: cancelPlanAction.bind(null, tenantId), fix: mock ? fixPlanPaymentAction.bind(null, tenantId) : null, endTrial: mock ? endPlanTrialAction.bind(null, tenantId) : null }}
          />
        )}
      </div>
    </main>
  );
}
