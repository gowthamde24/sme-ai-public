"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { changeTakeOver, type Change } from "@/lib/take-over/source";
import { requireUser } from "@/lib/auth/session";

/** The Owner's switch for live take-over of a call. Only the Owner (the API checks again and audits the change); the answer is shown back from what the API answered. */
export async function setTakeOverAction(tenantId: string, enabled: unknown): Promise<Change> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const out = await changeTakeOver({ token: user.accessToken, tenantId }, enabled);
    if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
    return out;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
}
