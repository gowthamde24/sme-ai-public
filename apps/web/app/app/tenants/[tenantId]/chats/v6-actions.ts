"use server";

import { revalidatePath } from "next/cache";

import { fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { setAssistant } from "@/lib/chats/assistant-switch";
import { requireUser } from "@/lib/auth/session";
import { designV6 } from "@/lib/screens/flag";

/**
 * "Assistant: on/off" for one chat (design system v6; Owner and Admin). The choice is kept in a cookie of the browser while C1 has no way to save it (lib/chats/assistant-switch.ts). Turning it off only stops the assistant answering THIS chat on its own: nothing already waiting
 * is sent or removed. The answer is the state now, or a closed word.
 */
export type SwitchResult = { ok: true; on: boolean } | { ok: false; error: "forbidden" | "not_available" };
export async function setChatAssistantAction(tenantId: string, leadId: string, on: unknown): Promise<SwitchResult> {
  if (!designV6() || typeof on !== "boolean" || !isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: "not_available" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await setAssistant(leadId, on))) return { ok: false, error: "not_available" };
  revalidatePath(`/app/tenants/${tenantId}/chats`);
  return { ok: true, on };
}
