import type { JobKind } from "./types";

/**
 * Starting a job by saying it (decision-ai-team.md; contracts/jobs-web-needs.md sections 4 and 5): the owner says or types a sentence, the assistant answers with a PLAN (nothing has started), and only "Start" begins anything.
 * The API sends codes with numbers; the web holds the sentences (`jobs.new.*`). Until C1's API is live the screens run on `lib/jobs/plan-mock.ts` (JOBS=mock). The one place that reads the API's shape is `parsePlan` in lib/api/jobs.ts.
 */
export type PlanChannel = "call" | "whatsapp";
export type PlanSays = { language: string; channel: PlanChannel; text: string };
export type PlanExcluded = { code: string; count: number };
/** The hours as minutes since midnight (the plan may send a whole hour or "HH:MM"; 24:00 is 1440), the days as codes (`jobs.new.day.<code>`; a weekday number 1 to 7 is read as mon to sun). */
export type PlanWhen = { fromMin: number; toMin: number; days: string[]; pacePerHour: number };
export type PlanCost = { minutes: number; minutesIncluded: number; /** the minutes already used this month (early access) */ minutesUsed: number; /** whole rupees on a paid plan, else null (early access: free minutes) */ rupees: number | null };

/** Who a plan is for, the closed list of the contract (`who.basis.code`; `params {days, count}`): the Who line is built from it (`jobs.new.who.<code>`), `plan.title` stays the planner's own text. */
export const PLAN_BASES = ["enquired_calls", "bought_calls", "consented_messages", "named_list", "said_yes_offer", "none"] as const;
export type PlanBasisCode = (typeof PLAN_BASES)[number];
/** What may block a plan (a 200 with `blockers`, never a 422): the codes the web has a sentence for (any other code gets the plain one). */
export const PLAN_BLOCKERS = ["unclear_who", "no_number", "no_whatsapp", "minutes_used"] as const;

export type PlanFinds = { key: string; text: string | null };

export type JobPlan = {
  planId: string;
  /** What the assistant understood, in a few words (the planner's text, not a code). */
  title: string;
  /** Who it is for: `basis` is a code with numbers (`jobs.new.who.<code>`), `eligible` of `total`, and the ones left out with a reason code each. */
  who: { basis: { code: PlanBasisCode; params: Readonly<Record<string, string | number>> }; total: number; eligible: number; excluded: PlanExcluded[] };
  /** What the customer hears or reads, already composed by the API (the business name and the AI line are in it). */
  says: PlanSays[];
  when: PlanWhen;
  /** What the job finds out: a key (`jobs.new.finds.<key>`) and the API's own line for it, which is shown when the web has no words for the key. */
  findsOut: PlanFinds[];
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

/** What may be asked of the planner (contract section 4): the owner's sentence, a suggested job's kind (Look first), or the WhatsApp version of a plan already shown (`as: "whatsapp"` with its id). */
export type PlanInput = { text: string } | { kind: JobKind } | { as: "whatsapp"; planId: string };
export const PLAN_TEXT_MIN = 3;
export const PLAN_TEXT_MAX = 500;

/** What starting a job answers: the job that now exists (a 200 `{job_id}`), or `409 approval_needed`: the Owner's OK is asked first and the web says "Waiting for your OK" with a way to it on Today (`approval {id, kind}`). */
export type JobApproval = { id: string; kind: string };
export type JobStarted = { jobId: string } | { approval: JobApproval };
/** `POST /jobs/plan/{id}/test-call` | `/test-message`: to the owner's OWN phone only. `minutesUsed` = the estimate counted against the free minutes (a call about 1, a message 0). `mock` = made-up answer, nothing was called or sent. */
export type JobTested = { channel: PlanChannel; mock: boolean; minutesUsed: number };

/** A suggested job for the business type (`GET /jobs/suggestions`): the sentence of why it fits (code + numbers) and a preview of what it says. */
export type Suggestion = { kind: JobKind; /** a title of its own (the wedding-season offer), else the plain job name */ title: { code: string } | null; why: { code: string; params: Readonly<Record<string, string | number>> }; preview: string; ready: boolean };

/** The suggestions for the business, and the word of its heading (`jobs.new.sug.<heading>`: "saree" = "Jobs for a saree shop"; null = "Jobs to start with"). */
export type SuggestionList = { items: Suggestion[]; heading: string | null };
