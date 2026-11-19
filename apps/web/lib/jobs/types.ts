/**
 * JOBS (decision-ai-team.md, owner 19 Nov 2026): everything the assistant does for the shop is a JOB, a plain sentence card with an on/off switch and its results. The shape follows contracts/jobs-web-needs.md (C2's needs, for C1's contract
 * draft): the API sends CODES with PARAMS (never prose); the web holds the sentences in four languages (`jobs.*` words). Until C1's API is live the screens run on `lib/jobs/mock.ts` (JOBS=mock).
 */
export const JOB_KINDS = ["speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher", "payment_reminders", "custom"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** running = on and working, waiting = needs the owner (an OK), failed = something did not go, done = finished its work today, paused = switched off. */
export const JOB_STATUSES = ["running", "waiting", "failed", "done", "paused"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobParams = Readonly<Record<string, string | number>>;
export type JobResult = { code: string; params: JobParams };

export type Job = {
  id: string;
  kind: JobKind;
  /** The name the owner gave it ("Priya"); null = the plain job name. With a name, customers hear "Priya, the AI assistant of {business}". */
  customName: string | null;
  enabled: boolean;
  status: JobStatus;
  /** The one result line: a code the web has a sentence for (`jobs.res.<code>`) and its numbers. */
  result: JobResult;
  /** How many things of this job wait for the owner. */
  needsYou: number;
  lastRunAt: string | null;
  /** A failed job's one-tap fix (for example `template_needed` for 2 messages), or null. */
  fix: { code: string; count: number } | null;
};

/** Which of the four solid chips a status wears (design/jobs.css): the colour is never the only sign, the word and an icon sit with it. */
export const CHIP_TONE: Record<JobStatus, "done" | "wait" | "fail" | "info"> = { running: "info", waiting: "wait", failed: "fail", done: "done", paused: "info" };

export const jobNameKey = (kind: JobKind): string => `jobs.kind.${kind}`;
export const jobStatusKey = (status: JobStatus): string => `jobs.status.${status}`;
export const jobResultKey = (code: string): string => `jobs.res.${code}`;

/** A switch that was just pressed: the result of `setJobEnabled`. */
export type JobSwitched = { id: string; enabled: boolean; status: JobStatus };

/** The Today section and the Jobs page filter the same way. */
export const JOB_FILTERS = ["all", "running", "needs_you", "paused"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];
export function filterJobs(jobs: readonly Job[], f: JobFilter): Job[] {
  if (f === "running") return jobs.filter((j) => j.enabled && j.status !== "paused");
  if (f === "needs_you") return jobs.filter((j) => j.status === "waiting" || j.status === "failed" || j.needsYou > 0);
  if (f === "paused") return jobs.filter((j) => !j.enabled || j.status === "paused");
  return [...jobs];
}
