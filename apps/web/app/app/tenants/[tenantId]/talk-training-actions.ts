"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { putTalkTraining, resetTalkTraining } from "@/lib/api/talk-training";
import { requireUser } from "@/lib/auth/session";
import { talkTrainingScreens } from "@/lib/screens/flag";
import { REASONS, cleanEdit, type Reason, type TalkError, type TalkTrainingState } from "@/lib/talk-training/types";

/**
 * The two moves of "How I talk to customers": save the whole document, or go back to the defaults. Only the Owner (the API also wants the second factor and says so: the closed word `mfa`). The workspace is the one the page bound, the
 * document is checked again here (lib/talk-training/types.ts cleanEdit), and what the screen shows afterwards is what the API answered.
 */
export type TalkResult = { ok: true; data: TalkTrainingState } | { ok: false; error: TalkError };

const refusal = (error: unknown): TalkError => {
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return (REASONS as readonly string[]).includes(error.reason ?? "") ? (error.reason as Reason) : "invalid";
  }
  return "down";
};

async function asOwner(tenantId: string, act: (token: string) => Promise<TalkTrainingState>): Promise<TalkResult> {
  if (!talkTrainingScreens()) return { ok: false, error: "not_available" };
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const data = await act(user.accessToken);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: refusal(error) };
  }
}

export async function saveTalkTrainingAction(tenantId: string, input: unknown): Promise<TalkResult> {
  const doc = cleanEdit(input);
  if (!doc.ok) return doc;
  return asOwner(tenantId, (token) => putTalkTraining(token, tenantId, doc.data));
}

export async function resetTalkTrainingAction(tenantId: string): Promise<TalkResult> {
  return asOwner(tenantId, (token) => resetTalkTraining(token, tenantId));
}
