"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { cancelPlan, endPlanTrial, fixPlanPayment, startPlanTrial } from "@/lib/plan/source";
import type { PlanResult } from "@/lib/plan/types";

/**
 * The moves of the plan screens (job DK). Each one: a signed-in person, a workspace they belong to as Owner or Admin (the API says which; anything else is `forbidden`), then lib/plan/source.ts, which refuses with
 * `not_available` unless the fake provider is switched on (NEXT_PUBLIC_PLAN_SCREENS=mock). Nothing here talks to a payment company; no card number is asked for anywhere.
 */
async function allowed(tenantId: string): Promise<PlanResult | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  return null;
}
async function done(tenantId: string, result: PlanResult): Promise<PlanResult> {
  if (result.ok) {
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    revalidatePath(`/app/tenants/${tenantId}/plans`);
  }
  return result;
}

export async function startPlanAction(tenantId: string, planId: string, method: string): Promise<PlanResult> {
  return (await allowed(tenantId)) ?? done(tenantId, await startPlanTrial(String(planId), String(method)));
}
export async function cancelPlanAction(tenantId: string): Promise<PlanResult> {
  return (await allowed(tenantId)) ?? done(tenantId, await cancelPlan());
}
export async function fixPlanPaymentAction(tenantId: string): Promise<PlanResult> {
  return (await allowed(tenantId)) ?? done(tenantId, await fixPlanPayment());
}
export async function endPlanTrialAction(tenantId: string): Promise<PlanResult> {
  return (await allowed(tenantId)) ?? done(tenantId, await endPlanTrial());
}
