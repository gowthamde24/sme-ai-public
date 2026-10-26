/**
 * "Ask Vijaya to do it" (night 4, job DR part B): the shapes of the tasks API (contract-tasks.md; the generated packages/contracts/tasks.ts), as the web holds them. Pure and client-safe: no request, no dictionary. Every result is
 * `simulated` until telephony exists, and the wording the API makes is `draft` (native review pending). Money is integer paise, counted by code, never by the model.
 */
export const TASK_STATUSES = ["needs_answer", "planned", "approved", "running", "paused", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_LANGS = ["en", "te", "hi", "kn", "ta", "ml"] as const;
export type TaskLang = (typeof TASK_LANGS)[number];
export const TASK_TEMPLATES = ["call_new_leads", "reengage_old_leads", "confirm_appointments", "collect_feedback", "payment_reminder", "supplier_price_enquiry", "offer_invite", "custom"] as const;
export type TaskTemplateId = (typeof TASK_TEMPLATES)[number];
export const TASK_CHANNELS = ["call", "whatsapp", "both"] as const;
export type TaskChannel = (typeof TASK_CHANNELS)[number];
export const QUESTION_TYPES = ["text", "amount", "date", "yesno"] as const;
export const FOLLOW_UPS = ["none", "whatsapp_summary", "call_back"] as const;
export const CONTACT_STATUSES = ["waiting", "excluded", "in_progress", "done", "failed", "skipped"] as const;
export type TaskContactStatus = (typeof CONTACT_STATUSES)[number];
export const SHORT_ANSWER_KINDS = ["cheapest", "counts"] as const;

/** The longest instruction the API takes (characters) and the shortest. */
export const INSTRUCTION_MIN = 3;
export const INSTRUCTION_MAX = 1500;
export const ANSWER_MAX = 500;

export type Question = { key: string; text: string; type: (typeof QUESTION_TYPES)[number] };
export type PlanWindow = { date: string; from_minute: number; to_minute: number };
export type FollowUp = { kind: (typeof FOLLOW_UPS)[number]; after_hours: number };
export type SampleContact = { contact_id: string; name: string | null };
export type Unmatched = { name: string | null; phone_last4: string };
export type PlanOut = {
  channel: TaskChannel;
  goal: string;
  questions: Question[];
  script_notes: string;
  message_text: string | null;
  window: PlanWindow;
  follow_up: FollowUp;
  contacts_total: number;
  contacts_sample: SampleContact[];
  unmatched: Unmatched[];
  notes: string[];
};
export type Estimate = { contacts: number; calls: number; messages: number; minutes: number; cost_paise: number; basis: string };
export type Progress = { total: number; excluded: number; waiting: number; in_progress: number; done: number; failed: number; skipped: number; reached: number; positive: number };
export type TaskOut = {
  id: string;
  status: TaskStatus;
  instruction: string;
  language: TaskLang;
  template: TaskTemplateId;
  question: string | null;
  plan: PlanOut | null;
  estimate: Estimate | null;
  cap_paise: number | null;
  spent_paise: number;
  pause_reason: "cap" | "owner" | null;
  progress: Progress;
  plan_sha256: string | null;
  simulated: boolean;
  wording: "draft";
  created_at: string;
  approved_at: string | null;
  finished_at: string | null;
};
export type TaskContactOut = {
  id: string;
  contact_id: string;
  name: string;
  phone_last4: string | null;
  status: TaskContactStatus;
  skip_reason: string | null;
  outcome: string | null;
  outcome_category: string | null;
  captured: Record<string, string | number | boolean | null> | null;
  simulated: boolean;
};
export type TaskContactsOut = { contacts: TaskContactOut[]; next_cursor: string | null };
export type TranscriptLine = { who: "assistant" | "contact"; text: string };
export type ReportTotals = { contacts: number; reached: number; positive: number; negative: number; unclear: number; no_answer: number; spent_paise: number };
export type ReportRow = {
  contact_id: string;
  name: string;
  phone_last4: string | null;
  outcome: string;
  category: string | null;
  captured: Record<string, string | number | boolean | null> | null;
  transcript: TranscriptLine[] | null;
  recording_url: string | null;
  simulated: boolean;
  message_status: string | null;
};
export type ReportOut = { task_id: string; status: TaskStatus; short_answer: string; short_answer_kind: (typeof SHORT_ANSWER_KINDS)[number]; totals: ReportTotals; rows: ReportRow[]; simulated: boolean; wording: "draft" };
export type TemplateOut = { id: TaskTemplateId; label: string; channel_default: TaskChannel; needs_pack: string | null; promotional: boolean; example_instruction: string };
export type TemplatesOut = { templates: TemplateOut[] };

/** A task that can still move: the page polls it. */
export const isLive = (s: TaskStatus): boolean => s === "approved" || s === "running";
/** A task that is over (its report is there). */
export const isOver = (s: TaskStatus): boolean => s === "done" || s === "cancelled";
/** The three lists of the Tasks page. A paused task is still running in the owner's eyes (it is waiting for them, so it is listed with the running ones). */
export type TaskTab = "running" | "waiting" | "finished";
export const TASK_TABS: readonly TaskTab[] = ["running", "waiting", "finished"];
export function tabOf(s: TaskStatus): TaskTab {
  return s === "planned" || s === "needs_answer" ? "waiting" : s === "done" || s === "cancelled" ? "finished" : "running";
}

/** The pack a template is not for: `needs_pack: "not <pack>"`. The code never names a business type; the API's own string says which. */
export function excludedPack(needsPack: string | null): string | null {
  return needsPack !== null && needsPack.startsWith("not ") ? needsPack.slice(4).trim() || null : null;
}
/** Is the template offered to a workspace of this pack? */
export function templateOffered(t: Pick<TemplateOut, "needs_pack">, packId: string | null): boolean {
  const not = excludedPack(t.needs_pack);
  return not === null || packId !== not;
}

/** What went wrong with a task action, in a closed list the screens have a sentence for. */
export type TaskError = "not_available" | "forbidden" | "invalid" | "changed" | "mfa" | "read_only" | "waiting_for_whatsapp" | "not_for_schools" | "nobody" | "state" | "not_found" | "busy" | "down";
export type Done<T> = { ok: true; value: T } | { ok: false; error: TaskError };

/** Where a task is, 0 to 100, for the bar. */
export function percentDone(p: Progress): number {
  const active = p.total - p.excluded;
  if (active <= 0) return 0;
  const finished = p.done + p.failed + p.skipped;
  return Math.max(0, Math.min(100, Math.round((finished / active) * 100)));
}
/** "3 of 12": finished (done, failed or skipped) of those not left out. */
export function progressCounts(p: Progress): { finished: number; of: number } {
  return { finished: Math.min(p.done + p.failed + p.skipped, Math.max(0, p.total - p.excluded)), of: Math.max(0, p.total - p.excluded) };
}
