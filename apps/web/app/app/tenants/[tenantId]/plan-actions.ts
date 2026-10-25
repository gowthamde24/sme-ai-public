"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { cancelPlan, endPlanTrial, fixPlanPayment, resumePlan, startPlanTrial } from "@/lib/plan/source";
import type { PlanCtx, PlanResult } from "@/lib/plan/types";

/**
 * The moves of the plan screens (job DK). Each one: a signed-in person, a workspace they belong to as its Owner (the API says which; the plan is the Owner's to change, an Admin only sees it; anything else is `forbidden`),
 * then lib/plan/source.ts: the API of job DI (PLAN_SCREENS=1) or the fake cookie provider (PLAN_SCREENS=mock); with the flag off every move is `not_available`. Nothing here talks to a payment company; no card number is asked for anywhere.
 */
async function allowed(tenantId: string): Promise<{ ctx: PlanCtx } | { refused: PlanResult }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { refused: { ok: false, error: "invalid" } };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { refused: { ok: false, error: "forbidden" } };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { refused: { ok: false, error: "not_available" } };
  }
  return { ctx: { token: user.accessToken, tenantId } };
}
async function run(tenantId: string, move: (ctx: PlanCtx) => Promise<PlanResult>): Promise<PlanResult> {
  const a = await allowed(tenantId);
  if ("refused" in a) return a.refused;
  const result = await move(a.ctx);
  if (result.ok) {
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    revalidatePath(`/app/tenants/${tenantId}/plans`);
  }
  return result;
}

export async function startPlanAction(tenantId: string, planId: string, method: string): Promise<PlanResult> {
  return run(tenantId, (ctx) => startPlanTrial(ctx, String(planId), String(method)));
}
export async function resumePlanAction(tenantId: string, planId: string, method: string): Promise<PlanResult> {
  return run(tenantId, (ctx) => resumePlan(ctx, String(planId), String(method)));
}
export async function cancelPlanAction(tenantId: string): Promise<PlanResult> {
  return run(tenantId, cancelPlan);
}
export async function fixPlanPaymentAction(tenantId: string): Promise<PlanResult> {
  return run(tenantId, fixPlanPayment);
}
export async function endPlanTrialAction(tenantId: string): Promise<PlanResult> {
  return run(tenantId, endPlanTrial);
}
