"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiRequestError } from "@/lib/api/client";
import { changeSearch, checkPlanInput, checkSearchPatch, planJob, startPlan, startSuggestion, testPlan } from "@/lib/api/jobs";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/types";
import type { JobPlan, JobStarted, JobTested, PlanChannel, PlanInput, SearchPatch } from "@/lib/jobs/plan";

import { DECIDERS, invalid } from "../../retailers/finder-guard";
import { jobsWho } from "../guard";
import { jobsRefusal } from "../refusal";

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
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  try {
    return { ok: true, data: await planJob(ctx.token, tenantId, body, lang) };
  } catch (error) {
    // only a 404 means "not there yet" (contract 1.1): said in plain words, never "not found, it may have been removed" (staging 20 Nov: POST /jobs/plan answered 404)
    if (error instanceof ApiRequestError && error.status === 404) return { ...jobsRefusal(error, ctx.t, lang), error: ctx.t("jobs.err.plan_not_ready") };
    return jobsRefusal(error, ctx.t, lang);
  }
}

/** A Lead Finder plan card's three choices (the area, how many, the fit bar): only what changed; the whole plan answers, with the same id. Changes the plan and nothing else: no search runs and nothing starts. */
export async function changeSearchAction(tenantId: string, planId: string, patch: SearchPatch): Promise<Reply<JobPlan>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  let checked: SearchPatch;
  try {
    if (!isPlanId(planId) || typeof patch !== "object" || patch === null) throw new Error("input");
    checked = checkSearchPatch(patch);
  } catch {
    return invalid(ctx.t);
  }
  try {
    return { ok: true, data: await changeSearch(ctx.token, tenantId, planId, checked) };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}

/** "Start" on a plan card: the one thing that begins a job. */
export async function startPlanAction(tenantId: string, planId: string): Promise<Reply<JobStarted>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isPlanId(planId)) return invalid(ctx.t);
  try {
    const data = await startPlan(ctx.token, tenantId, planId);
    revalidatePath(`/app/tenants/${tenantId}/jobs`);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, data };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}

/** "Start" on a suggested job: one tap. */
export async function startSuggestionAction(tenantId: string, kind: JobKind): Promise<Reply<JobStarted>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof kind !== "string" || !(JOB_KINDS as readonly string[]).includes(kind)) return invalid(ctx.t);
  try {
    const data = await startSuggestion(ctx.token, tenantId, kind);
    revalidatePath(`/app/tenants/${tenantId}/jobs`);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, data };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}

/** "Test call / test message to my phone": to the owner's OWN phone only, never to a customer. */
export async function testPlanAction(tenantId: string, planId: string, channel: PlanChannel): Promise<Reply<JobTested>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isPlanId(planId) || (channel !== "call" && channel !== "whatsapp")) return invalid(ctx.t);
  try {
    return { ok: true, data: await testPlan(ctx.token, tenantId, planId, channel) };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}
