"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { actOnAssistant, type Act } from "@/lib/assistant-status/act";
import type { AssistantState, Missing } from "@/lib/assistant-status/types";

/** Go live and Pause of My assistant (owner, 13 Nov 2026): the Owner only (C1's routes ask for the Owner and no second factor; the role is checked here as well). The answer is a closed word, never the API's text. */
export type GoLiveResult = { ok: true; state: AssistantState } | { ok: false; error: "missing"; missing: Missing[] } | { ok: false; error: "forbidden" | "not_available" | "down" };

async function act(tenantId: string, what: Act): Promise<GoLiveResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "down" };
  }
  const out = await actOnAssistant(user.accessToken, tenantId, what);
  if (!out.ok) return out.error === "not_ready" ? { ok: false, error: "missing", missing: out.missing } : { ok: false, error: out.error };
  revalidatePath(`/app/tenants/${tenantId}`, "layout"); // (the menu's badge is part of the frame)
  return { ok: true, state: out.status.state };
}

export async function goLiveAction(tenantId: string): Promise<GoLiveResult> {
  return act(tenantId, "go-live");
}
export async function pauseAction(tenantId: string): Promise<GoLiveResult> {
  return act(tenantId, "pause");
}
