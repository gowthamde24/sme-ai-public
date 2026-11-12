"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { speaksPanelScreens, talkTrainingScreens } from "@/lib/screens/flag";
import { cleanIntroduce } from "@/lib/talk-training/introduce";
import { speaksProblem, type HowSpeaks, type SpeaksChange, type SpeaksProblem } from "@/lib/talk-training/speaks";
import { saveSpeaks, type Facts } from "@/lib/talk-training/speaks-source";

import { readFacts } from "./speaks-facts";

/**
 * "How your assistant speaks": the Owner saves any subset of Tone, Words (with Region) and Introduce as (job speaks-panel; C1's contract docs/contracts/how-assistant-speaks.md: Owner and the second factor, `403 mfa_required`; `422 validation_error`). Checked here first with the contract's rules.
 * The answer is the whole object as it now stands.
 */
export type SpeaksResult = { ok: true; data: HowSpeaks } | { ok: false; error: SpeaksProblem | "forbidden" | "mfa" | "not_available" | "down" | "rejected" };

export async function saveSpeaksAction(tenantId: string, input: unknown): Promise<SpeaksResult> {
  if (!talkTrainingScreens() || speaksPanelScreens() === "off") return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "forbidden" };
  const problem = speaksProblem(input);
  if (problem) return { ok: false, error: problem };
  const c = input as SpeaksChange;
  const change: SpeaksChange = { ...c, ...(c.introduceAs ? { introduceAs: cleanIntroduce(c.introduceAs) } : {}) };
  const user = await requireUser();
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { ok: false, error: "forbidden" };
    const facts: Facts = await readFacts(user.accessToken, tenantId, user.id);
    const data = await saveSpeaks({ token: user.accessToken, tenantId }, change, facts);
    revalidatePath(`/app/tenants/${tenantId}/ai-team/training`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "mfa_required") return { ok: false, error: "mfa" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422) {
        // C1's closed `error.reason` (docs/contracts/how-assistant-speaks.md) names what was refused; without one, a refusal of a save that carried Introduce as is most likely that
        if (error.reason === "region_not_of_language") return { ok: false, error: "region" };
        if (error.reason !== undefined) return { ok: false, error: "introduce" };
        return { ok: false, error: change.introduceAs ? "introduce" : "rejected" };
      }
    }
    return { ok: false, error: "down" };
  }
}
