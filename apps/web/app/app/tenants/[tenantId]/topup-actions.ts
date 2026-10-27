"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { parseSettingsInput } from "@/lib/topups/input";
import { buyTopup, previewPlanUpgrade, saveTopupSettings, simulateUsage, upgradePlan } from "@/lib/topups/source";
import type { PreviewResult, TopupCtx, TopupResult } from "@/lib/topups/types";

import { readAccessCached } from "./today-read";

/**
 * The moves of the top-up screens (night 4, part F2): buy a pack, set the auto top-up and the overage, preview an upgrade and upgrade. Each one: a signed-in person who is the Owner of the workspace (the API says which: an Admin
 * only sees these parts; the API also asks for the second factor, which comes back as `mfa`), a workspace that is not read-only (`read_only`), then lib/topups/source.ts: the fake cookie provider (TOPUP_SCREENS=mock) or C1's API (=1). With
 * the flag off every move is `not_available`. A purchase carries an id the browser made, so pressing twice (or a retry after a lost answer) never buys twice. The payment is FAKE: nothing here talks to a payment company.
 */
async function allowed(tenantId: string): Promise<{ ctx: TopupCtx } | { refused: { ok: false; error: "invalid" | "forbidden" | "not_available" | "read_only" } }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { refused: { ok: false, error: "invalid" } };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { refused: { ok: false, error: "forbidden" } };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { refused: { ok: false, error: "not_available" } };
  }
  // a read-only workspace (its trial ended unpaid) changes nothing here; a read that fails says "not read-only" because the API refuses all the same
  try {
    if ((await readAccessCached(user.accessToken, tenantId)).readOnly) return { refused: { ok: false, error: "read_only" } };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  return { ctx: { token: user.accessToken, tenantId } };
}
async function run(tenantId: string, move: (ctx: TopupCtx) => Promise<TopupResult>): Promise<TopupResult> {
  const a = await allowed(tenantId);
  if ("refused" in a) return a.refused;
  const result = await move(a.ctx);
  if (result.ok) {
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    revalidatePath(`/app/tenants/${tenantId}/plans`);
    revalidatePath(`/app/tenants/${tenantId}`);
  }
  return result;
}

export async function buyTopupAction(tenantId: string, purchaseId: string, packCode: string, method: string): Promise<TopupResult> {
  return run(tenantId, (ctx) => buyTopup(ctx, String(purchaseId), String(packCode), String(method)));
}
export async function saveTopupSettingsAction(tenantId: string, input: unknown): Promise<TopupResult> {
  const parsed = parseSettingsInput(input);
  if (!parsed) return { ok: false, error: "invalid" };
  return run(tenantId, (ctx) => saveTopupSettings(ctx, parsed));
}
export async function previewUpgradeAction(tenantId: string, planId: string): Promise<PreviewResult> {
  const a = await allowed(tenantId);
  if ("refused" in a) return a.refused;
  return previewPlanUpgrade(a.ctx, String(planId));
}
export async function upgradeAction(tenantId: string, planId: string, method: string): Promise<TopupResult> {
  return run(tenantId, (ctx) => upgradePlan(ctx, String(planId), String(method)));
}
/** Test mode only. */
export async function simulateUsageAction(tenantId: string, percent: number): Promise<TopupResult> {
  return run(tenantId, (ctx) => simulateUsage(ctx, Number(percent)));
}
