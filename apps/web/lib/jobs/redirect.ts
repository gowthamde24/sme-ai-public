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

/**
 * JOBS ON (planner, 19 Nov): the old Office and My AI team pages ARE the Jobs page now ("Office" and "AI team" are replaced by "Jobs"), so their addresses lead there, with no end date: a bookmark, an old link or a message from last month still arrives. The old page's own query (`?agent=`, `?tab=`)
 * is dropped (the Jobs page has its own). With JOBS OFF nothing changes. Only the two landing addresses go (`/office`, `/ai-team`): "Train how it talks" (`/ai-team/training`) and the live-calls page keep their own addresses. This is a temporary (307) redirect on purpose while JOBS is
 * switched on page by page on staging, so a browser never keeps a permanent one to a page that is switched off again; the day JOBS is on for everybody, `redirect` becomes `permanentRedirect` here (one word).
 */
export async function officeToJobs(token: string, tenantId: string): Promise<void> {
  if (jobsScreens() === "off") return;
  // while the API has no jobs list at all for this workspace (not there yet: readJobs null) the Jobs page is empty, so the old Office / My AI team page stays: nothing is hidden behind an empty page (staging, 20 Nov: GET /jobs answered 404)
  if ((await readJobs(token, tenantId)) === null) return;
  redirect(`/app/tenants/${tenantId}/jobs`);
}
