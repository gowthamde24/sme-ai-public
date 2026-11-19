import type { JobKind } from "./types";

/**
 * Starting a job by saying it (decision-ai-team.md; contracts/jobs-web-needs.md sections 4 and 5): the owner says or types a sentence, the assistant answers with a PLAN (nothing has started), and only "Start" begins anything.
 * The API sends codes with numbers; the web holds the sentences (`jobs.new.*`). Until C1's API is live the screens run on `lib/jobs/plan-mock.ts` (JOBS=mock). The one place that reads the API's shape is `parsePlan` in lib/api/jobs.ts.
 */
export type PlanChannel = "call" | "whatsapp";
export type PlanSays = { language: string; channel: PlanChannel; text: string };
export type PlanExcluded = { code: string; count: number };
export type PlanWhen = { fromHour: number; toHour: number; days: string[]; pacePerHour: number };
export type PlanCost = { minutes: number; minutesIncluded: number; /** whole rupees on a paid plan, else null (early access: free minutes) */ rupees: number | null };

export type JobPlan = {
  planId: string;
  /** What the assistant understood, in a few words (the planner's text, not a code). */
  title: string;
  /** Who it is for: `basis` is a code with numbers (`jobs.new.who.<code>`), `eligible` of `total`, and the ones left out with a reason code each. */
  who: { basis: { code: string; params: Readonly<Record<string, string | number>> }; total: number; eligible: number; excluded: PlanExcluded[] };
  /** What the customer hears or reads, already composed by the API (the business name and the AI line are in it). */
  says: PlanSays[];
  when: PlanWhen;
  /** Keys of what the job finds out (`jobs.new.finds.<key>`). */
  findsOut: string[];
  cost: PlanCost;
  /** "start" = the plan is what was asked; "send_whatsapp" = nobody can be called, the WhatsApp is the way. */
  primary: "start" | "send_whatsapp";
  alternatives: { kind: "whatsapp"; count: number }[];
  /** Why the plan cannot start (for example `unclear_who`: the assistant could not tell who is meant). Empty = it can. */
  blockers: string[];
  expiresInMinutes: number | null;
};

/** The channel of a plan: what its first line says through (a plan with no line is a call). */
export const planChannel = (p: JobPlan): PlanChannel => p.says[0]?.channel ?? "call";
export const planBlocked = (p: JobPlan): boolean => p.blockers.length > 0;

export type PlanInput = { text: string; as?: "whatsapp" } | { kind: JobKind };
export const PLAN_TEXT_MIN = 3;
export const PLAN_TEXT_MAX = 500;

/** `POST /jobs/plan/{id}/start` and `POST /jobs {kind}`: the job that now exists. */
export type JobStarted = { jobId: string };
/** `POST /jobs/plan/{id}/test-call` | `/test-message`: to the owner's OWN phone only. `mock` = made-up answer, nothing was called or sent. */
export type JobTested = { channel: PlanChannel; mock: boolean };

/** A suggested job for the business type (`GET /jobs/suggestions`): the sentence of why it fits (code + numbers) and a preview of what it says. */
export type Suggestion = { kind: JobKind; /** a title of its own (the wedding-season offer), else the plain job name */ title: { code: string } | null; why: { code: string; params: Readonly<Record<string, string | number>> }; preview: string; ready: boolean };

/** The suggestions for the business, and the word of its heading (`jobs.new.sug.<heading>`: "saree" = "Jobs for a saree shop"; null = "Jobs to start with"). */
export type SuggestionList = { items: Suggestion[]; heading: string | null };
