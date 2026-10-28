"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { saveVoiceChoice, type SaveError } from "@/lib/voice-picker/source";

/** The voice picker's one move: the Owner or an Admin chooses the voice of a language (`null` = back to the default). The workspace is the one the page bound the action to; the language and the voice id are checked again in lib/voice-picker/source.ts. */
export type VoiceChoiceResult = { ok: true } | { ok: false; error: SaveError };

export async function chooseVoiceAction(tenantId: string, language: unknown, voiceId: unknown): Promise<VoiceChoiceResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
  const out = await saveVoiceChoice({ token: user.accessToken, tenantId }, language, voiceId);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out.ok ? { ok: true } : out;
}
