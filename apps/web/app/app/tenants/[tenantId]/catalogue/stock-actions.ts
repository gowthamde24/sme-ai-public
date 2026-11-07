"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { MAX_QUANTITY, putQuantity } from "@/lib/api/catalogue";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { appV4 } from "@/lib/screens/flag";

/**
 * "2 left" (app v4 part 6, C1's money-and-stock.md): the Owner or an Admin sets how many of a saree are left, or stops counting. A whole number from 0 to 1,000,000, or null. The same number again changes nothing, so a retry is safe.
 * Sales and Viewers are refused here and by the API (403); an item of another workspace is a 404. There is no automatic undo: setting the old number again is the undo.
 */
export type StockResult = { ok: true; quantity: number | null } | { ok: false; error: "forbidden" | "invalid" | "gone" | "not_available" | "down" };

export async function setStockCountAction(tenantId: string, itemId: string, quantity: unknown): Promise<StockResult> {
  if (!appV4()) return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) return { ok: false, error: "invalid" };
  if (quantity !== null && (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY)) return { ok: false, error: "invalid" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
    await putQuantity(user.accessToken, tenantId, itemId, quantity);
    revalidatePath(`/app/tenants/${tenantId}/catalogue`);
    return { ok: true, quantity };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404) return { ok: false, error: "gone" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "down" };
  }
}
