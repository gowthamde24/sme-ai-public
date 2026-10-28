"use server";

import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { getLang } from "@/i18n/get-lang";
import { appT } from "@/i18n/app";
import { runDemoStep } from "@/lib/guided-demo/events";
import { isStepKey, type StepResult } from "@/lib/guided-demo/script";
import { guidedDemo } from "@/lib/screens/flag";
import { readIsDemo } from "./today-read";

const RUN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The guided demo's one move: run ONE step of the story for the workspace the page bound the action to. Only where the flag is on, only the Owner or an Admin of a workspace that is a DEMO one (the API's own word on billing/access, else its name "DEMO ..."), and only the closed step
 * words: anything else is refused before the API is asked. The run id and the lead id come back from the browser, are checked to be plain ids and are only used for what the signed-in person may do anyway (lib/guided-demo/events.ts).
 */
export async function runDemoStepAction(tenantId: string, key: unknown, run: unknown, leadId: unknown): Promise<StepResult> {
  const user = await requireUser();
  if (!guidedDemo() || !isCanonicalUuid(tenantId) || !isStepKey(key) || typeof run !== "string" || !RUN.test(run)) return { ok: false };
  if (leadId !== null && (typeof leadId !== "string" || !isCanonicalUuid(leadId))) return { ok: false };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if ((tenant.role !== "owner" && tenant.role !== "admin") || !(await readIsDemo(user.accessToken, tenantId, tenant.name))) return { ok: false };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
  const question = appT(await getLang())("gd.ask.q");
  try {
    return await runDemoStep({ token: user.accessToken, tenantId }, key, { run, leadId: (leadId as string | null) ?? null, question });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}
