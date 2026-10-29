"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { saveVoiceChoice, saveVoiceGender, type SaveError } from "@/lib/voice-picker/source";

/** The voice picker's one move: the Owner or an Admin chooses the voice of a language (`null` = back to the default). The workspace is the one the page bound the action to; the language and the voice id are checked again in lib/voice-picker/source.ts. */
export type VoiceChoiceResult = { ok: true } | { ok: false; error: SaveError };

/** Only the Owner or an Admin of the workspace the page bound the action to may change the voice. */
async function gate(tenantId: string): Promise<{ ok: true; token: string } | { ok: false; error: SaveError }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
  return { ok: true, token: user.accessToken };
}

export async function chooseVoiceAction(tenantId: string, language: unknown, voiceId: unknown): Promise<VoiceChoiceResult> {
  const g = await gate(tenantId);
  if (!g.ok) return g;
  const out = await saveVoiceChoice({ token: g.token, tenantId }, language, voiceId);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out.ok ? { ok: true } : out;
}

/** Female or Male, for the whole workspace. */
export async function chooseVoiceGenderAction(tenantId: string, gender: unknown): Promise<VoiceChoiceResult> {
  const g = await gate(tenantId);
  if (!g.ok) return g;
  const out = await saveVoiceGender({ token: g.token, tenantId }, gender);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out.ok ? { ok: true } : out;
}
