"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { setJobEnabled } from "@/lib/api/jobs";
import type { JobSwitched } from "@/lib/jobs/types";

import { DECIDERS, invalid } from "../retailers/finder-guard";
import { jobsWho } from "./guard";
import { jobsRefusal } from "./refusal";

/** The switch of a job (owner 19 Nov: "a switch per job"): Owner and Admin. It stops or starts only that job; nothing is sent by pressing it (a job starts working on the next event or at its next time). */
export async function setJobEnabledAction(tenantId: string, jobId: string, enabled: boolean): Promise<Reply<JobSwitched>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof jobId !== "string" || !isCanonicalUuid(jobId) || typeof enabled !== "boolean") return invalid(ctx.t);
  try {
    const data = await setJobEnabled(ctx.token, tenantId, jobId, enabled);
    revalidatePath(`/app/tenants/${tenantId}`);
    revalidatePath(`/app/tenants/${tenantId}/jobs`);
    return { ok: true, data };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}
