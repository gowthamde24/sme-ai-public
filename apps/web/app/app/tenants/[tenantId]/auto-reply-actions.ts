"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { changeAutoReply, type Change } from "@/lib/auto-reply/source";
import { requireUser } from "@/lib/auth/session";

/** The Owner's switch for the assistant's automatic replies. Only the Owner (the API also needs the second factor and says so as the closed word `mfa`); the answer is shown back from what the API answered, never from what the browser sent. */
export async function setAutoReplyAction(tenantId: string, enabled: unknown): Promise<Change> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const out = await changeAutoReply({ token: user.accessToken, tenantId }, enabled);
    if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
    return out;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
}
