"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { setConversationAssistant } from "@/lib/api/whatsapp";
import { setAssistant, switchIsApi } from "@/lib/chats/assistant-switch";
import { requireUser } from "@/lib/auth/session";
import { designV6 } from "@/lib/screens/flag";

/**
 * "Assistant: on/off" for one chat (design system v6; Owner and Admin). With CHAT_ASSISTANT_SWITCH=1 it is C1's `POST /conversations/{lead_id}/assistant`; with `mock` the choice is kept in a cookie of the browser (lib/chats/assistant-switch.ts). Turning it off only stops the assistant answering THIS chat on its own: nothing already waiting
 * is sent or removed. The answer is the state now, or a closed word.
 */
export type SwitchResult = { ok: true; on: boolean } | { ok: false; error: "forbidden" | "not_available" };
export async function setChatAssistantAction(tenantId: string, leadId: string, on: unknown): Promise<SwitchResult> {
  if (!designV6() || typeof on !== "boolean" || !isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: "not_available" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "forbidden" };
  }
  if (switchIsApi()) {
    try {
      await setConversationAssistant(user.accessToken, tenantId, leadId, on);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      return { ok: false, error: "not_available" };
    }
  } else if (!(await setAssistant(leadId, on))) return { ok: false, error: "not_available" };
  revalidatePath(`/app/tenants/${tenantId}/chats`);
  return { ok: true, on };
}
