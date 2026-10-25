"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { saveAssistant, type SaveResult } from "@/lib/assistant/source";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";

/**
 * Saving Settings > AI assistant (job DM): a signed-in person who is the Owner of the workspace (the API says which; the assistant is the Owner's to set up), the value checked by `parseSettings` (anything that is not in its shape is
 * `invalid`), then lib/assistant/source.ts: the fake cookie (ASSISTANT_SCREENS=mock) or C1's API (=1; the Owner needs the second factor: `mfa`). With the flag off or the API missing it answers `not_available` and changes nothing.
 */
export async function saveAssistantAction(tenantId: string, input: unknown): Promise<SaveResult> {
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
  const result = await saveAssistant({ token: user.accessToken, tenantId }, input, pack?.modules ?? null);
  if (result.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return result;
}
