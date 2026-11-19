/**
 * JOBS (decision-ai-team.md, owner 19 Nov 2026): everything the assistant does for the shop is a JOB, a plain sentence card with an on/off switch and its results. The shape is C1's FINAL 1.0 contract (contracts/jobs-contract-DRAFT.md; lib/api/jobs.ts parses it): the API sends CODES with PARAMS (never prose); the web holds the sentences in four languages (`jobs.*` words). Until C1's API is live the screens run on `lib/jobs/mock.ts` (JOBS=mock).
 */
/** `payment_reminders` is v1.1: the closed list keeps the word, but the API sends NO job of that kind in v1 and nothing here may rely on one (the redirect from /campaigns falls back to the Jobs page). */
export const JOB_KINDS = ["speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher", "payment_reminders", "custom"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** running = on and working, waiting = needs the owner (an OK), failed = something did not go, done = finished its work today, paused = switched off. */
export const JOB_STATUSES = ["running", "waiting", "failed", "done", "paused"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobParams = Readonly<Record<string, string | number>>;
export type JobResult = { code: string; params: JobParams };

/** Why a job cannot run yet, the closed list of the contract (`plan_gate.code`): the plan or the setup blocks it. The web holds one short note for each (`jobs.gate.<code>`). */
export const PLAN_GATES = ["billing_blocked", "no_number", "no_whatsapp", "minutes_used"] as const;
export type PlanGate = (typeof PLAN_GATES)[number];
export const jobGateKey = (gate: PlanGate): string => `jobs.gate.${gate}`;

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
  /** What blocks the job before it can run (a phone number, WhatsApp, free minutes, billing), or null. */
  planGate: PlanGate | null;
  /** How this job sounds to customers: the language, the voice (its first name) and the number it calls or writes from. Each may be missing (the shop's own); null = the API says nothing (older answer). A named job shows them as chips. */
  speaks?: JobSpeaks | null;
};
/** `voice` is the catalogue id, `voiceName` the owner's word for it ("Soft woman"; the chip shows the name). The number is only ever the shop's. */
export type JobSpeaks = { language: string | null; voice: string | null; voiceName: string | null; number: string | null };

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

/** What a `needs_you` item of `GET /jobs/today` points at (`target.type`, the closed list of the contract). */
export const NEEDS_TARGETS = ["order", "lead", "call_request", "approval", "message"] as const;
export type NeedsTarget = (typeof NEEDS_TARGETS)[number];
/** One thing that waits for the owner: `{id, code, kind, at, target {type, id}}` (nothing else). Today's count is its length; Today keeps its own list for the cards. */
export type NeedsYouItem = { id: string; code: string; kind: string; at: string; target: { type: NeedsTarget; id: string } };

/** `GET /jobs/today` (the first paint of Today in one call): the jobs (full Job objects), what waits for the owner and the main assistant's name. */
export type TodayJobs = { jobs: Job[]; needsYou: NeedsYouItem[]; assistantName: string | null };
