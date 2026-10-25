"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { remove, sentenceFor, type MoveResult } from "@/lib/own-voice/source";
import { requireUser } from "@/lib/auth/session";

/**
 * The two small moves of the own-voice card that are not an upload (job DP): asking for the sentence to read (it has the person's name and the business in it) and deleting the voice. Only the Owner of the workspace; the API
 * needs the second factor to delete (`mfa`). Anything else is "not available" and changes nothing.
 */
async function owner(tenantId: string): Promise<{ token: string; business: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return tenant.role === "owner" ? { token: user.accessToken, business: tenant.name } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function sentenceAction(tenantId: string, name: string): Promise<string | null> {
  const who = await owner(tenantId);
  return who ? sentenceFor({ token: who.token, tenantId }, String(name), who.business) : null;
}

export async function deleteVoiceAction(tenantId: string): Promise<MoveResult> {
  const who = await owner(tenantId);
  if (!who) return { ok: false, code: "forbidden" };
  const out = await remove({ token: who.token, tenantId });
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out;
}
