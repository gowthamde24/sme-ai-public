"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { clearCampaign, saveCampaignOverride } from "@/lib/call-settings/campaign-source";
import type { SaveResult } from "@/lib/call-settings/source";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";

/**
 * Saving or clearing the call settings of one campaign (job DQ part 3): only the Owner of the workspace (the API says which, and asks for the second factor: `mfa`); the override is checked by `parseOverride` against the workspace's own
 * settings (anything outside the ranges is `invalid`); then lib/call-settings/campaign-source.ts: the fake cookie (CALL_SETTINGS_SCREENS=mock) or the API (=1).
 */
async function owner(tenantId: string, campaignId: string): Promise<{ token: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return tenant.role === "owner" ? { token: user.accessToken } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function saveCampaignCallsAction(tenantId: string, campaignId: string, input: unknown): Promise<SaveResult> {
  const who = await owner(tenantId, campaignId);
  if (!who) return { ok: false, error: "not_available" };
  const pack = await readPackCached(who.token, tenantId);
  const out = await saveCampaignOverride({ token: who.token, tenantId }, campaignId, input, pack?.modules ?? null);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/campaigns/${campaignId}`);
  return out;
}

export async function clearCampaignCallsAction(tenantId: string, campaignId: string): Promise<SaveResult> {
  const who = await owner(tenantId, campaignId);
  if (!who) return { ok: false, error: "not_available" };
  const out = await clearCampaign({ token: who.token, tenantId }, campaignId);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/campaigns/${campaignId}`);
  return out;
}
