import { redirect } from "next/navigation";

import { readJobs } from "@/lib/api/jobs";
import { jobsScreens } from "@/lib/screens/flag";

import type { JobKind } from "./types";

/**
 * JOBS ON (planner decision 19 Nov): the old landing pages of Rules and Campaigns lead to the job that now owns them ("two places to change the same thing goes against no hidden layers"); with JOBS OFF nothing changes. The old page stays reachable at
 * `?all=1` (the job page's "More choices" -> "All settings for this job"), so no feature is lost. When the API has no jobs yet (readJobs null) the old page simply stays.
 */
export async function redirectToJob(token: string, tenantId: string, kind: JobKind | null, all: unknown): Promise<void> {
  if (jobsScreens() === "off" || all === "1") return;
  const jobs = await readJobs(token, tenantId);
  if (!jobs) return;
  const job = kind ? jobs.find((j) => j.kind === kind) : undefined;
  redirect(job ? `/app/tenants/${tenantId}/jobs/${job.id}` : `/app/tenants/${tenantId}/jobs`);
}

/** The old page behind each job's "All settings for this job" link (`?all=1` skips the redirect above). */
export const ALL_SETTINGS: Partial<Record<JobKind, string>> = { speed_to_lead: "/outreach/rules?all=1", offers: "/outreach?all=1", payment_reminders: "/campaigns?all=1" };
