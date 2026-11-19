import { jobsScreens } from "@/lib/screens/flag";
import type { JobDetail } from "@/lib/jobs/detail";
import type { WhoTarget } from "@/lib/jobs/who";

import { getJob, readJobs } from "./jobs";

export type { WhoTarget };

/**
 * The one other job the Who talks card offers to change by talking: "Make the visits job speak Telugu" (mock sheet r3-06, the assistant's `jobs.change`). It is the visits job (`store_visits`) when this page is another job and the visits job does not speak Telugu yet.
 * Read from the jobs list and that job's own page (its `speaks`); any failure means no suggestion (never an error on the page). Off = nothing.
 */
export async function readWhoTarget(token: string, tenantId: string, current: JobDetail): Promise<WhoTarget | null> {
  if (jobsScreens() === "off" || !current.who || current.job.kind === "store_visits") return null;
  try {
    const sibling = (await readJobs(token, tenantId))?.find((j) => j.kind === "store_visits" && j.id !== current.job.id);
    if (!sibling) return null;
    const detail = await getJob(token, tenantId, sibling.id);
    if (!detail?.who || detail.who.language === "te") return null;
    return { id: sibling.id, kind: sibling.kind, customName: sibling.customName, language: detail.who.language, to: "te" };
  } catch {
    return null;
  }
}
