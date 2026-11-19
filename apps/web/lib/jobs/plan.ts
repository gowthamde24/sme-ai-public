import type { JobKind } from "./types";

/**
 * Starting a job by saying it (decision-ai-team.md; contracts/jobs-web-needs.md sections 4 and 5): the owner says or types a sentence, the assistant answers with a PLAN (nothing has started), and only "Start" begins anything.
 * The API sends codes with numbers; the web holds the sentences (`jobs.new.*`). Until C1's API is live the screens run on `lib/jobs/plan-mock.ts` (JOBS=mock). The one place that reads the API's shape is `parsePlan` in lib/api/jobs.ts.
 */
export type PlanChannel = "call" | "whatsapp";
export type PlanSays = { language: string; channel: PlanChannel; text: string };
/** Why people are left out of a plan, the closed list of the contract (`who.excluded[].code`): the web has a sentence for each (`jobs.new.excl.<code>`). */
export const EXCLUDED_CODES = ["no_consent", "no_proof_of_request", "stopped", "prospect", "no_phone", "already_contacted_recently"] as const;
export type ExcludedCode = (typeof EXCLUDED_CODES)[number];
export type PlanExcluded = { code: ExcludedCode; count: number };
/** The day codes of the contract (`Plan.when.days`, and the read-only mirror in `JobDetail.when.days`), in the order of the week. */
export const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayCode = (typeof DAY_CODES)[number];
/** Where a plan's `when` starts: today, tomorrow, or once the owner says OK (`after_ok`). */
export const WHEN_STARTS = ["today", "tomorrow", "after_ok"] as const;
export type WhenStart = (typeof WHEN_STARTS)[number];
/** `Plan.when {start, from, to, days, pace_per_hour}`: `from` and `to` are "HH:MM" (here minutes since midnight), `days` always lists the days (mon..sun). */
export type PlanWhen = { start: WhenStart; fromMin: number; toMin: number; days: DayCode[]; pacePerHour: number };
export type PlanCost = {
  minutes: number;
  minutesIncluded: number;
  /** the minutes already used this month (early access) */
  minutesUsed: number;
  /** whole rupees on a paid plan, else null (early access: free minutes) */
  rupees: number | null;
  /** The WhatsApp part of the plan (contract 1.1 part 1, T12): `count` messages; `rupees` a whole-rupee amount (GST extra) or null; `included` = inside the plan's free messages. null/absent = the plan says nothing about messages. */
  messages?: PlanMessagesCost | null;
  /** A Lead Finder plan counts searches, not calls: the free searches left this month and how many the plan gives. null/absent = not a search plan. */
  searches?: { left: number; perMonth: number } | null;
};
export type PlanMessagesCost = { count: number; rupees: number | null; included: boolean };

/** What a Lead Finder (researcher) plan will look for (`Plan.search`): the area in the owner's words (default: the shop's town), how many results (5, 10 or 20) and the fit bar (the lowest fit, 0 to 100, a prospect needs to be shown; 60, 70, 80 or 90 are offered). */
export const SEARCH_RESULTS = [5, 10, 20] as const;
export const SEARCH_FIT_BARS = [60, 70, 80, 90] as const;
export const SEARCH_AREA_MAX = 60;
export type PlanSearch = { area: string; results: number; fitBar: number };
/** What may be changed on a search plan (`PATCH /jobs/plan/{id} {search: {...only what changed}}`). */
export type SearchPatch = { area?: string; results?: (typeof SEARCH_RESULTS)[number]; fitBar?: (typeof SEARCH_FIT_BARS)[number] };

/** Who a plan is for, the closed list of the contract (`who.basis.code`; `params {days, count}`): the Who line is built from it (`jobs.new.who.<code>`), `plan.title` stays the planner's own text. */
export const PLAN_BASES = ["enquired_calls", "bought_calls", "consented_messages", "named_list", "said_yes_offer", "none"] as const;
export type PlanBasisCode = (typeof PLAN_BASES)[number];
/** What may block a plan (a 200 with `blockers`, never a 422): the codes the web has a sentence for (any other code gets the plain one). */
export const PLAN_BLOCKERS = ["unclear_who", "no_number", "no_whatsapp", "minutes_used", "search_limit", "area_needed"] as const;

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
  /** What a Lead Finder plan will look for, or null/absent (every other plan). Its `says` is empty and its cost counts searches. */
  search?: PlanSearch | null;
  /** Why the plan cannot start (for example `unclear_who`: the assistant could not tell who is meant). Empty = it can. */
  blockers: string[];
  expiresInMinutes: number | null;
};

/** The channel of a plan: what its first line says through (a plan with no line is a call). */
export const planChannel = (p: JobPlan): PlanChannel => p.says[0]?.channel ?? "call";
export const planBlocked = (p: JobPlan): boolean => p.blockers.length > 0;

/**
 * What may be asked of the planner (contract section 4): the owner's sentence, a suggested job's kind (Look first), the WhatsApp version of a plan already shown (`as: "whatsapp"` with its id), or a template card's "Use this" (`templateId` = the snake_case id in jobs.json, `ask` = the card's sentence).
 * The REAL planner is given the id (`POST /jobs/plan {template_id, language}`: it starts from the template, never guesses from words); the mock planner is given the sentence, exactly as if it had been typed.
 */
export type PlanInput = { text: string } | { kind: JobKind } | { as: "whatsapp"; planId: string } | { templateId: string; ask: string };
/** The id of a job template in jobs.json (snake_case, as every pack writes it). */
export const TEMPLATE_ID = /^[a-z][a-z0-9_]{0,79}$/;
export const PLAN_TEXT_MIN = 3;
export const PLAN_TEXT_MAX = 500;

/** What is waiting for the owner's OK (`approval.kind`, the closed list of the contract): a list of calls, a standing rule, a plan for a list, an offer, a Lead Finder search. */
export const APPROVAL_KINDS = ["task", "rule", "batch", "offer", "search"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
/** What starting a job answers: the job that now exists (a 200 `{job_id}`), or `409 approval_needed`: the Owner's OK is asked first and the web says "Waiting for your OK: the offer" with a way to it on Today (`approval {id, kind}`). */
export type JobApproval = { id: string; kind: ApprovalKind };
export type JobStarted = { jobId: string } | { approval: JobApproval };
/** `POST /jobs/plan/{id}/test-call` | `/test-message`: to the owner's OWN phone only. `minutesUsed` = the estimate counted against the free minutes (a call about 1, a message 0). `mock` = made-up answer, nothing was called or sent. */
export type JobTested = { channel: PlanChannel; mock: boolean; minutesUsed: number };

/** A suggested job for the business type (`GET /jobs/suggestions`): the sentence of why it fits (code + numbers) and a preview of what it says. */
export type Suggestion = { kind: JobKind; /** a title of its own (the wedding-season offer), else the plain job name */ title: { code: string } | null; why: { code: string; params: Readonly<Record<string, string | number>> }; preview: string; ready: boolean };

/** The suggestions for the business, and the word of its heading (`jobs.new.sug.<heading>`: "saree" = "Jobs for a saree shop"; null = "Jobs to start with"). */
export type SuggestionList = { items: Suggestion[]; heading: string | null };
