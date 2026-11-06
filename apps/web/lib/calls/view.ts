import type { CallRow } from "@/lib/api/calls";
import type { TimelineKind } from "@/lib/api/customer-timeline";

/**
 * The Calls pages' plain-words parts (app v4 part 4), pure so they are tested without a server. Nothing is guessed: a refusal is said by the group its closed word belongs to; "Where X is now" marks only the steps the customer's own
 * timeline shows; what was captured is shown by its own key, in words.
 */
export type RefuseGroup = "setup" | "time" | "limit" | "permission" | "number" | "rule";
const GROUP: Record<string, RefuseGroup> = {
  telephony_off: "setup", live_not_confirmed: "setup", not_on_sandbox_list: "setup", workspace_paused: "setup", billing_blocked: "setup", inbound_off: "setup", no_such_line: "setup",
  outside_window: "time", outside_hours: "time", holiday: "time",
  weekly_limit: "limit", daily_cap: "limit", minutes_cap: "limit", already_calling: "limit", too_many_calls: "limit",
  not_approved: "permission", no_consent: "permission", suppressed: "permission", erased_or_archived: "permission", dnd: "permission", dnd_unknown: "permission", blocked_caller: "permission",
  bad_number: "number",
  purpose_not_allowed: "rule", school_rule: "rule", no_ai_disclosure: "rule",
};
/** A closed word the web does not know yet is still said, as one of the call rules. */
export const refuseGroup = (reason: string | null): RefuseGroup => (reason && GROUP[reason]) || "rule";

/** The customer's steps, in order (the design's "Where X is now"): a step is done when the customer's timeline has a row of its kind. */
export const STAGES = ["enquiry", "call", "quote", "visit", "follow_up", "order"] as const;
export type Stage = (typeof STAGES)[number];
const STAGE_OF: Record<TimelineKind, Stage> = { arrival: "enquiry", message_in: "enquiry", message_out: "follow_up", call: "call", outcome: "call", quote: "quote", visit: "visit", follow_up: "follow_up", order: "order" };
export function stagesDone(kinds: readonly TimelineKind[], live: boolean): Set<Stage> {
  const done = new Set<Stage>(kinds.map((k) => STAGE_OF[k]));
  if (live) done.add("call"); // this call is a step already, before its row exists
  return done;
}

/** "visit_day" -> "Visit day": the API's own key, in words (the keys are closed words; their values are what the customer said). */
export const capturedLabel = (key: string): string => {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** mm:ss of a call's length (or of the time since it was answered). */
export const callClock = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The list's two parts: the live calls (ringing or on the line), then the rest as the API ordered them. */
export function splitCalls(items: readonly CallRow[]): { live: CallRow[]; earlier: CallRow[] } {
  return { live: items.filter((c) => c.live), earlier: items.filter((c) => !c.live) };
}

/** A correction to send: only what changed; an empty field the person cleared is sent empty (which clears it). Null = nothing changed. */
export function correctionBody(before: { summary: string; captured: Readonly<Record<string, string>>; note: string }, after: { summary: string; captured: Readonly<Record<string, string>>; note: string }): { summary?: string; captured?: Record<string, string>; note?: string } | null {
  const body: { summary?: string; captured?: Record<string, string>; note?: string } = {};
  if (after.summary.trim() !== before.summary.trim()) body.summary = after.summary.trim().slice(0, 600);
  if (after.note.trim() !== before.note.trim()) body.note = after.note.trim().slice(0, 300);
  const keys = Object.keys(after.captured);
  if (keys.some((k) => (after.captured[k] ?? "").trim() !== (before.captured[k] ?? "").trim())) body.captured = Object.fromEntries(keys.map((k) => [k, (after.captured[k] ?? "").trim().slice(0, 200)]).filter(([, v]) => v !== ""));
  return Object.keys(body).length ? body : null;
}
