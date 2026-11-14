"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { askConsentForTask, askErrorOf, dismissAskFirst, type AskHow, type AskOutcome } from "@/lib/api/ask-consent";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

/**
 * The "ask first" item of Needs you (owner, 14 Nov 2026): the Owner asks the people a plan left out (a WhatsApp "reply OK", never consent by itself) or confirms they agreed (recorded; a new plan for them). Bound to the workspace by the page; the API checks the role again. A refusal is a closed word, the sentence is the screen's.
 */
async function owner(tenantId: string, id: string) {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(id)) return null;
  try {
    return (await fetchTenant(user.accessToken, tenantId)).role === "owner" ? user : "forbidden";
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function askFirstAction(tenantId: string, taskId: string, how: AskHow): Promise<AskOutcome> {
  if (how !== "whatsapp" && how !== "owner_confirms") return { ok: false, error: "down" };
  const user = await owner(tenantId, taskId);
  if (user === null) return { ok: false, error: "state" };
  if (user === "forbidden") return { ok: false, error: "forbidden" };
  try {
    const result = await askConsentForTask(user.accessToken, tenantId, taskId, how);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: askErrorOf(error) };
  }
}

export async function dismissAskFirstAction(tenantId: string, taskId: string): Promise<{ ok: boolean }> {
  const user = await owner(tenantId, taskId);
  if (user === null || user === "forbidden") return { ok: false };
  try {
    await dismissAskFirst(user.accessToken, tenantId, taskId);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}
