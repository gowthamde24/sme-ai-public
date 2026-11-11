"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { PRACTICE, practiceCall, putTalkTraining, resetTalkTraining, type PracticeReply } from "@/lib/api/talk-training";
import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { requireUser } from "@/lib/auth/session";
import { talkTrainingScreens } from "@/lib/screens/flag";
import { REASONS, cleanEdit, type Reason, type TalkError, type TalkTrainingState } from "@/lib/talk-training/types";

/**
 * The two moves of "How I talk to customers": save the whole document, or go back to the defaults. Only the Owner (the API also wants the second factor and says so: the closed word `mfa`). The workspace is the one the page bound, the
 * document is checked again here (lib/talk-training/types.ts cleanEdit), and what the screen shows afterwards is what the API answered.
 */
export type TalkResult = { ok: true; data: TalkTrainingState } | { ok: false; error: TalkError };

const refusal = (error: unknown, sentIntroduce = false): TalkError => {
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) {
      if ((REASONS as readonly string[]).includes(error.reason ?? "")) return error.reason as Reason;
      // C1, 11 Nov: the "Introduce as" refusals are a 422 `validation_error` (fields ["introduce_as"]); only a document that carries it can be refused for it
      return error.code === "validation_error" && sentIntroduce ? "introduce_as" : "invalid";
    }
  }
  return "down";
};

async function asOwner(tenantId: string, act: (token: string) => Promise<TalkTrainingState>, sentIntroduce = false): Promise<TalkResult> {
  if (!talkTrainingScreens()) return { ok: false, error: "not_available" };
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const data = await act(user.accessToken);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    revalidatePath(`/app/tenants/${tenantId}/ai-team/training`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: refusal(error, sentIntroduce) };
  }
}

export async function saveTalkTrainingAction(tenantId: string, input: unknown): Promise<TalkResult> {
  const doc = cleanEdit(input);
  if (!doc.ok) return doc;
  return asOwner(tenantId, (token) => putTalkTraining(token, tenantId, doc.data), doc.data.introduceAs !== null && doc.data.introduceAs.kind !== "business");
}

export async function resetTalkTrainingAction(tenantId: string): Promise<TalkResult> {
  return asOwner(tenantId, (token) => resetTalkTraining(token, tenantId));
}

/**
 * A practice call in text (app v4 part 4, C1 #392): the Owner (or an Admin) plays the customer and the assistant answers with the same call prompt and rules as a real call. Nothing is stored or sent, and there is no voice. `training` is the
 * Owner's unsaved changes (checked like a save), so they can be tried first; null = the saved training. The turns are checked here too: 1 to 20, each 1 to 400 characters, the last one the customer's.
 */
export type PracticeError = "forbidden" | "invalid" | "unavailable" | "busy" | "not_available" | "down";
export type PracticeResult = { ok: true; data: PracticeReply } | { ok: false; error: PracticeError };

export async function practiceCallAction(tenantId: string, language: unknown, turns: unknown, training: unknown): Promise<PracticeResult> {
  if (!talkTrainingScreens()) return { ok: false, error: "not_available" };
  if (!(CALL_LANGS as readonly unknown[]).includes(language)) return { ok: false, error: "invalid" };
  if (!Array.isArray(turns) || turns.length < 1 || turns.length > PRACTICE.turns) return { ok: false, error: "invalid" };
  const clean = turns.map((x) => (typeof x === "object" && x !== null && ((x as { who?: unknown }).who === "customer" || (x as { who?: unknown }).who === "assistant") && typeof (x as { text?: unknown }).text === "string" ? { who: (x as { who: "customer" | "assistant" }).who, text: (x as { text: string }).text.trim() } : null));
  if (clean.some((x) => x === null || x.text.length < 1 || x.text.length > PRACTICE.text) || clean[clean.length - 1]?.who !== "customer") return { ok: false, error: "invalid" };
  let draft = null;
  if (training !== null && training !== undefined) {
    const doc = cleanEdit(training);
    if (!doc.ok) return { ok: false, error: "invalid" };
    draft = doc.data;
  }
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
    return { ok: true, data: await practiceCall(user.accessToken, tenantId, language as CallLang, clean as { who: "customer" | "assistant"; text: string }[], draft) };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "practice_unavailable" || error.status === 503) return { ok: false, error: "unavailable" };
      if (error.code === "practice_busy" || error.status === 429) return { ok: false, error: "busy" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "down" };
  }
}
