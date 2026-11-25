import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * Speed to lead and "approve once" (night 4, part A3; contract-speed-approvals.md and the generated packages/contracts/outreach.ts): a BATCH plan (one approval for everybody), standing RULES per lead source, hot-lead HAND-OFFS and the
 * lead REPORT. Calls and WhatsApp are fake until telephony exists; the plan, the approvals, the timing, the caps and the reports are real. Money is integer paise. Pure types and closed word lists: no request, no cookie.
 */
export const GOALS = ["site_visit", "counselling", "appointment", "qualify", "test_drive", "site_measurement", "quote", "trial", "callback", "general"] as const;
export type Goal = (typeof GOALS)[number];
export const CHANNELS = ["call", "whatsapp", "both"] as const;
export type Channel = (typeof CHANNELS)[number];
export const BATCH_STATUSES = ["planned", "running", "paused", "done", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const PAUSE_REASONS = ["owner", "cap_calls", "cap_minutes", "billing"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
/**
 * Call first (owner decision 5 Nov 2026, docs/decisions/call-first-auto-send.md): a standing rule CALLS a new lead; WhatsApp-first rules are refused by the API and the database. A rule's channel is a call, or "both" = a call, and
 * WhatsApp only when the customer asks for it or agrees to it on the call (its message is the words that then go). A batch's "whatsapp" (the Owner's own message campaign to a list) is unchanged.
 */
export const RULE_ACTIONS = ["call_within_minutes"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];
export const RULE_CHANNELS = ["call", "both"] as const satisfies readonly Channel[];
export { CALL_LANGS };
export type { CallLang };

/** The lead source tags (exact strings, contract-lead-sources.md section 0): what the Lead Desk, the imports, the rules and the report all key on. */
export const SOURCE_TAGS = ["indiamart", "justdial", "99acres", "magicbricks", "housing", "sulekha", "tradeindia", "meta_lead_ads", "website_form", "webhook", "email_forward", "excel_upload", "google_sheet", "pasted_list", "vcard"] as const;
export type SourceTag = (typeof SOURCE_TAGS)[number];
/** The tags a standing rule is offered for: where leads ARRIVE by themselves (a file upload is a batch, not a rule). */
export const RULE_SOURCES: readonly SourceTag[] = ["meta_lead_ads", "website_form", "indiamart", "justdial", "99acres", "magicbricks", "housing", "sulekha", "tradeindia", "webhook", "google_sheet"];

export type SampleContact = { contactId: string; nameMasked: string; city: string | null };
export type BatchPlan = {
  count: number;
  ready: number;
  /** Why some people are left out: no_phone, no_consent, stopped, duplicate, erased, other (numbers). */
  skipped: Readonly<Record<string, number>>;
  sample: readonly SampleContact[];
  windowFrom: string | null;
  windowTo: string | null;
  estimatedMinutes: number;
  estimatedMessages: number;
  estimatedCostPaise: number;
  maxCallsPerDay: number | null;
  maxTotalMinutes: number | null;
};
export type BatchProgress = { total: number; waiting: number; done: number; callsMade: number; connected: number; interested: number; minutesUsed: number; /** Visits the list booked and what the quotes made from it add up to, in paise: present when the API says them (design system v6 results), else absent. */ visitsBooked?: number | null; quotesPaise?: number | null };
export type Batch = {
  id: string;
  name: string;
  status: BatchStatus;
  pausedReason: PauseReason | null;
  goal: Goal;
  channel: Channel;
  language: CallLang;
  questions: readonly string[];
  messageText: string | null;
  windowDays: number;
  maxCallsPerDay: number | null;
  maxTotalMinutes: number | null;
  planSha256: string;
  createdAt: string;
  approvedAt: string | null;
  finishedAt: string | null;
};
export type BatchAnswer = { batch: Batch; plan: BatchPlan; progress: BatchProgress | null };
export type BatchItem = { id: string; contactId: string; leadId: string | null; name: string; status: "planned" | "waiting" | "done" | "stopped" | "skipped"; reason: string | null; attempts: number; nextAction: "call" | "whatsapp" | null; nextAt: string | null; lastResult: string | null };

/** Who a batch is for: a list of contacts or leads, or "every lead from this source (with this status, since this day)". */
export type Who = { kind: "contacts"; ids: readonly string[] } | { kind: "leads"; ids: readonly string[] } | { kind: "source"; source: SourceTag; status: "new" | "contacted" | "qualified" | "disqualified" | null; since: string | null };
export type BatchInput = {
  batchId: string;
  name: string;
  goal: Goal;
  channel: Channel;
  language: CallLang;
  who: Who;
  questions: readonly string[];
  messageText: string | null;
  windowDays: number;
  maxCallsPerDay: number | null;
  maxTotalMinutes: number | null;
};

/** A rule's language: one of the call languages, or "auto" (the lead's own language, else the business's main one; the default for a new rule). */
export type RuleLang = CallLang | "auto";
/** One step of what happens to a lead (C1 docs-private/plans/speed-to-lead-rules-v2.md): the call, the retries, then a WhatsApp template. */
export type RuleStep = { kind: "call"; minutes: number } | { kind: "retry"; afterMinutes: number } | { kind: "retry"; nextMorning: string } | { kind: "whatsapp"; template: string };
/** The policy's retry steps: after this many minutes, or the next morning at this minute of the day (570 = 09:30). */
export type RetryStep = { afterMinutes: number } | { nextMorningMinute: number };
/** An approved (or not yet) WhatsApp message a rule may name; `preview` is filled with sample values. */
export type RuleTemplate = { key: string; moment: "first" | "missed"; label: string; language: string; status: "approved" | "submitted" | "draft" | "missing"; preview: string; variables: readonly string[] };

export type Rule = {
  id: string;
  source: string;
  action: RuleAction;
  withinMinutes: number;
  goal: Goal;
  channel: Channel;
  /** A language, or "auto" = the lead's own language, else the business's main one (the server resolves it). */
  language: RuleLang;
  questions: readonly string[];
  /** WhatsApp is always an approved template, by name (never free text): the first message (after hours, or a first call that cannot start) and the one after the last unanswered call. null = the API's default. */
  waFirstTemplate: string | null;
  waMissedTemplate: string | null;
  /** The API's own notes on the rule, e.g. "template_not_approved" (the WhatsApp step is then skipped). */
  warnings: readonly string[];
  /** What happens to one lead, ready to print (the API's `plan.steps`); null when the API does not send it (the screen then builds it from the policy). */
  steps: readonly RuleStep[] | null;
  maxCallsPerDay: number | null;
  maxTotalMinutes: number | null;
  active: boolean;
  pausedReason: PauseReason | null;
  approvedAt: string;
  usage: { leads: number; callsToday: number; minutesUsed: number };
  /** The API names (within_minutes, source, usage, ...) of values the list could not read; the screen draws a dash for each (parseRuleRow). Absent when every value was read. */
  unreadable?: readonly string[];
};
export type RuleInput = { ruleId: string; source: SourceTag; action: RuleAction; withinMinutes: number; goal: Goal; channel: Channel; language: RuleLang; questions: readonly string[]; waFirstTemplate: string | null; waMissedTemplate: string | null; maxCallsPerDay: number | null; maxTotalMinutes: number | null };

export type Handoff = { id: string; leadId: string | null; contactId: string; contactName: string; summary: string; assignedTo: string; notifiedAt: string; reminderSentAt: string | null; actedAt: string | null };

export type SourceRow = { source: string; leads: number; firstTouchMedianSeconds: number | null; calls: number; connectedRate: number; interestedPct: number; bookings: number; callCostPaise: number; leadCostPaise: number; costPerBookingPaise: number | null; visits?: number | null; costPerLeadPaise?: number | null; spendPaise?: number | null; costPerVisitPaise?: number | null };
export type OutreachReport = { fromDay: string; toDay: string; bySource: readonly SourceRow[]; total: Omit<SourceRow, "source" | "firstTouchMedianSeconds"> };

export type Policy = {
  nightCallMinute: number;
  maxAttempts: number;
  retryGapHours: number;
  thenWhatsapp: boolean;
  whatsappAfterHours: boolean;
  handoffReminderMinutes: number;
  callPaisePerMinute: number;
  hours: { days: readonly number[]; fromMinute: number; toMinute: number; from: "assistant" | "call_settings" | "default" };
  /** The retry steps for a lead that does not answer (10 minutes, 2 hours, the next morning), or null when the API does not send them. */
  retrySteps: readonly RetryStep[] | null;
  saved: boolean;
};

/** A refusal in the closed words the screens turn into sentences. */
export type Refusal = "not_for_schools" | "mfa" | "changed" | "read_only" | "invalid" | "forbidden" | "state" | "down" | "not_available";
export type Done<T> = { ok: true; value: T } | { ok: false; error: Refusal };

export const goalWord = (g: Goal): string => `ld.goal.${g}`;
export const isSourceTag = (v: unknown): v is SourceTag => typeof v === "string" && (SOURCE_TAGS as readonly string[]).includes(v);
