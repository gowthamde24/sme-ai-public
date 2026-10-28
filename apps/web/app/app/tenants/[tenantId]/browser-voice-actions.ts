"use server";

import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { browserVoice } from "@/lib/screens/flag";

/**
 * "Talk to your assistant" (job DV): the API's WebSocket takes the person's sign-in in its FIRST MESSAGE (a browser socket cannot send a header; contract-browser-voice.md), so this is the one place the app hands the browser its access token: only where the
 * flag is on, only for a person who may use it (Owner, Admin or Sales of THAT workspace: the API checks again and closes with 4403 for anyone else), never kept, and the page's content-security-policy lets it be sent only to the API's socket address.
 */
export type VoiceTokenResult = { ok: true; token: string } | { ok: false };

export async function browserVoiceTokenAction(tenantId: string): Promise<VoiceTokenResult> {
  const user = await requireUser();
  if (!browserVoice() || !isCanonicalUuid(tenantId)) return { ok: false };
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin" && role !== "sales") return { ok: false };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
  return { ok: true, token: user.accessToken };
}
