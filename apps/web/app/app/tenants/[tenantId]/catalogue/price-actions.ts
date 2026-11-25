"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { undoPrice } from "@/lib/api/catalogue";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

/**
 * "Undo price change" (C1, 29 Nov 2026): the Owner puts back the price a saree had before its last price change, when that change is under 30 days old. The API decides (409 `nothing_to_undo`, 403 for anyone but the Owner); the answer is a closed word the
 * screen draws as a plain sentence. The undo is itself recorded as a change by the Owner.
 */
export type UndoResult = { ok: true } | { ok: false; error: "nothing_to_undo" | "forbidden" | "invalid" | "mfa_required" | "down" };

export async function undoPriceAction(tenantId: string, itemId: string): Promise<UndoResult> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) return { ok: false, error: "invalid" };
  const user = await requireUser();
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    await undoPrice(user.accessToken, tenantId, itemId);
    revalidatePath(`/app/tenants/${tenantId}/catalogue`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "nothing_to_undo" || error.reason === "nothing_to_undo") return { ok: false, error: "nothing_to_undo" };
      if (error.code === "mfa_required" || error.reason === "mfa_required") return { ok: false, error: "mfa_required" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "down" };
  }
}
