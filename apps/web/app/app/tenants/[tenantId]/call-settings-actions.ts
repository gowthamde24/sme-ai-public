"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { saveCallSettings, type SaveResult } from "@/lib/call-settings/source";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";

/**
 * Saving the call settings of Settings > AI assistant > Advanced (job DP): a signed-in person who is the Owner of the workspace (the API says which, and asks for the second factor: `mfa`), the value checked by
 * `parseCallSettings` (anything outside its ranges is `invalid`), a school's purposes held to the three it may have, then lib/call-settings/source.ts: the fake cookie (CALL_SETTINGS_SCREENS=mock) or the API (=1).
 */
export async function saveCallSettingsAction(tenantId: string, input: unknown): Promise<SaveResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { ok: false, error: "not_available" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const pack = await readPackCached(user.accessToken, tenantId);
  const result = await saveCallSettings({ token: user.accessToken, tenantId }, input, pack?.modules ?? null);
  if (result.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return result;
}
