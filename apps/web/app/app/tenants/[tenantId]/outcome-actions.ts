"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { correctOutcome, type CorrectResult } from "@/lib/outcomes/source";

/**
 * The owner's correction of an outcome (job DM): a signed-in person who is the Owner or an Admin of the workspace (the API says which; anyone else is `forbidden`-like and gets `not_available`), then lib/outcomes/source.ts:
 * the fake cookie (OUTCOME_SCREENS=mock) or, once C1's API exists, that. With the flag off or the API missing it answers `not_available` and changes nothing.
 */
export async function correctOutcomeAction(tenantId: string, id: string, result: string, category: string): Promise<CorrectResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "not_available" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const out = await correctOutcome({ token: user.accessToken, tenantId }, String(id), String(result), String(category));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}`, "layout");
  return out;
}
