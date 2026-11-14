"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { saveLimit, type LimitFail } from "@/lib/call-limit/source";
import type { CallLimit } from "@/lib/api/call-limit";
import { requireUser } from "@/lib/auth/session";

/** Changes the calls-a-day limit (the Owner only; no authenticator code: the card asks "Change the limit to N calls a day?" first). Bound to the workspace by the page. */
export async function saveCallLimitAction(tenantId: string, limit: number): Promise<{ ok: true; data: CallLimit } | { ok: false; error: LimitFail }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "down" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const out = await saveLimit(user.accessToken, tenantId, limit);
    if (out.ok) revalidatePath(`/app/tenants/${tenantId}/my-assistant`);
    return out;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
}
