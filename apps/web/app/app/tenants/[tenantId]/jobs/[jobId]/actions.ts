"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { addJobFaq, patchJob, removeJobFaq, testJob, type JobDetailTested, type JobPatched } from "@/lib/api/jobs";
import { checkFaq, checkJobName, isCode, type JobFaq, type TestChannel } from "@/lib/jobs/detail";

import { DECIDERS, invalid, refusal, who } from "../../retailers/finder-guard";

/**
 * The changes of one job's page (JOBS, owner 19 Nov): Owner and Admin only (Sales and Viewer read). Each one checks its input BEFORE the API is asked, and answers in the person's words when the API says no.
 * With JOBS=mock the answers are made up and nothing is stored or sent. Nothing here ever calls or messages a customer; the test buttons reach the owner's own phone only.
 */
type Ctx = Exclude<Awaited<ReturnType<typeof who>>, { ok: false }>;
async function allowed(tenantId: string, id: unknown): Promise<Ctx | Extract<Reply<never>, { ok: false }>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof id !== "string" || !isCanonicalUuid(id)) return invalid(ctx.t);
  return ctx;
}
const done = (tenantId: string, id: string): void => {
  revalidatePath(`/app/tenants/${tenantId}`);
  revalidatePath(`/app/tenants/${tenantId}/jobs`);
  revalidatePath(`/app/tenants/${tenantId}/jobs/${id}`);
};

async function change(tenantId: string, id: string, ctx: Ctx, patch: Parameters<typeof patchJob>[3]): Promise<Reply<JobPatched>> {
  try {
    const data = await patchJob(ctx.token, tenantId, id, patch);
    done(tenantId, id);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** The name of the job: at most 40 characters, empty = back to the plain name. */
export async function renameJobAction(tenantId: string, jobId: string, name: string): Promise<Reply<JobPatched>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (typeof name !== "string" || name.length > 400) return invalid(ctx.t);
  const checked = checkJobName(name);
  if (!checked.ok) return invalid(ctx.t);
  return change(tenantId, jobId, ctx, { name: checked.name });
}

/** One choice of the job ("right away", "3 times", a tick under More choices). */
export async function setJobSettingAction(tenantId: string, jobId: string, key: string, value: string): Promise<Reply<JobPatched>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (!isCode(key) || !isCode(value)) return invalid(ctx.t);
  return change(tenantId, jobId, ctx, { settings: { [key]: value } });
}

/** One tick of "What it finds out". */
export async function setJobFindsOutAction(tenantId: string, jobId: string, key: string, enabled: boolean): Promise<Reply<JobPatched>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (!isCode(key) || typeof enabled !== "boolean") return invalid(ctx.t);
  return change(tenantId, jobId, ctx, { findsOut: { [key]: enabled } });
}

export async function addJobFaqAction(tenantId: string, jobId: string, question: string, answer: string): Promise<Reply<JobFaq>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (typeof question !== "string" || typeof answer !== "string") return invalid(ctx.t);
  const checked = checkFaq(question, answer);
  if (!checked.ok) return invalid(ctx.t);
  try {
    const data = await addJobFaq(ctx.token, tenantId, jobId, checked.question, checked.answer);
    done(tenantId, jobId);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

export async function removeJobFaqAction(tenantId: string, jobId: string, faqId: string): Promise<Reply<{ id: string }>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (typeof faqId !== "string" || faqId.length > 80 || !/^[A-Za-z0-9_.:-]+$/.test(faqId)) return invalid(ctx.t);
  try {
    await removeJobFaq(ctx.token, tenantId, jobId, faqId);
    done(tenantId, jobId);
    return { ok: true, data: { id: faqId } };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** "Test call/message to my phone": the owner's own phone only; with JOBS=mock nothing is called or sent. */
export async function testJobAction(tenantId: string, jobId: string, channel: TestChannel): Promise<Reply<JobDetailTested>> {
  const ctx = await allowed(tenantId, jobId);
  if ("ok" in ctx) return ctx;
  if (channel !== "call" && channel !== "message") return invalid(ctx.t);
  try {
    return { ok: true, data: await testJob(ctx.token, tenantId, jobId, channel) };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}
