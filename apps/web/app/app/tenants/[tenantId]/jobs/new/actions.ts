"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { checkPlanInput, planJob, startPlan, startSuggestion, testPlan } from "@/lib/api/jobs";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/types";
import type { JobPlan, JobStarted, JobTested, PlanChannel, PlanInput } from "@/lib/jobs/plan";

import { DECIDERS, invalid, refusal, who } from "../../retailers/finder-guard";

/**
 * Starting a job by saying it (owner 19 Nov): Owner and Admin. The input is checked first (the sentence is 3 to 500 characters, a kind is one of ours); then the person's role. `planJobAction` and `testPlanAction` start nothing:
 * only `startPlanAction` and `startSuggestionAction` begin a job, and each is its own button.
 */
const isPlanId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v);

/** The plan card for a sentence (or for a suggested job's kind). Nothing starts. */
export async function planJobAction(tenantId: string, input: PlanInput): Promise<Reply<JobPlan>> {
  const lang = await getLang();
  let body: PlanInput;
  try {
    if (typeof input !== "object" || input === null) throw new Error("input");
    body = checkPlanInput(input);
  } catch {
    return invalid(appT(lang), "jobs.new.err.text");
  }
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  try {
    return { ok: true, data: await planJob(ctx.token, tenantId, body, lang) };
  } catch (error) {
    return refusal(error, ctx.t, lang);
  }
}

/** "Start" on a plan card: the one thing that begins a job. */
export async function startPlanAction(tenantId: string, planId: string): Promise<Reply<JobStarted>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isPlanId(planId)) return invalid(ctx.t);
  try {
    const data = await startPlan(ctx.token, tenantId, planId);
    revalidatePath(`/app/tenants/${tenantId}/jobs`);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** "Start" on a suggested job: one tap. */
export async function startSuggestionAction(tenantId: string, kind: JobKind): Promise<Reply<JobStarted>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof kind !== "string" || !(JOB_KINDS as readonly string[]).includes(kind)) return invalid(ctx.t);
  try {
    const data = await startSuggestion(ctx.token, tenantId, kind);
    revalidatePath(`/app/tenants/${tenantId}/jobs`);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** "Test call / test message to my phone": to the owner's OWN phone only, never to a customer. */
export async function testPlanAction(tenantId: string, planId: string, channel: PlanChannel): Promise<Reply<JobTested>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isPlanId(planId) || (channel !== "call" && channel !== "whatsapp")) return invalid(ctx.t);
  try {
    return { ok: true, data: await testPlan(ctx.token, tenantId, planId, channel) };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}
