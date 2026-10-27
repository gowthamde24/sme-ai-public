"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { previewLine, saveCampaignOpeningLine, saveOpeningLine, type SaveError } from "@/lib/opening-line/source";
import type { Preview } from "@/lib/opening-line/types";

/**
 * The moves of the opening-line editor (night 5). Only the Owner saves (the API checks again); the Owner and Admin may hear a preview. Each takes the workspace the page bound it to, never one the browser names, checks its input again in
 * lib/opening-line/source.ts and answers a closed word. The saved text is shown back from what the API answered, never from what the browser sent.
 */
export type Result = { ok: true } | { ok: false; error: SaveError };
export type PreviewResult = { ok: true; preview: Preview } | { ok: false; error: SaveError };

async function who(tenantId: string): Promise<{ token: string; role: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    return { token: user.accessToken, role: (await fetchTenant(user.accessToken, tenantId)).role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function saveOpeningLineAction(tenantId: string, input: unknown): Promise<Result> {
  const me = await who(tenantId);
  if (!me || me.role !== "owner") return { ok: false, error: "forbidden" };
  const out = await saveOpeningLine({ token: me.token, tenantId }, input);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out.ok ? { ok: true } : out;
}

export async function saveCampaignOpeningLineAction(tenantId: string, campaignId: string, input: unknown): Promise<Result> {
  const me = await who(tenantId);
  if (!me || me.role !== "owner" || !isCanonicalUuid(campaignId)) return { ok: false, error: "forbidden" };
  const out = await saveCampaignOpeningLine({ token: me.token, tenantId }, campaignId, input);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/campaigns/${campaignId}/call-settings`);
  return out.ok ? { ok: true } : out;
}

export async function previewOpeningLineAction(tenantId: string, language: unknown, text: unknown, mentionAi: unknown): Promise<PreviewResult> {
  const me = await who(tenantId);
  if (!me || (me.role !== "owner" && me.role !== "admin")) return { ok: false, error: "forbidden" };
  const out = await previewLine({ token: me.token, tenantId }, language, text, mentionAi !== false);
  return out.ok ? { ok: true, preview: out.data } : out;
}
