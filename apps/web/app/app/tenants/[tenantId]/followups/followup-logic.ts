/**
 * Pure logic of the follow-up screens (no server, no React): what a person's time field means, what the policy form's text means, which buttons a role is offered for a draft, and the words for
 * what the engine said. The screens only render what these functions return, so a redesign of the markup does not touch any rule. Every rule here is GUIDANCE for the screen: the database
 * decides again when anything is saved.
 *
 * Nothing in the follow-up screens sends a message. A touch, a draft and an approval are records of what a person did outside this system.
 */
import { DECISION_FALLBACK, DECISION_TEXT, GATE_TEXT, STOPPED_TEXT, followupSentence, STALE_CODES } from "@/lib/api/followup-text";
import type { Decision, Draft, DueItem, Gate, PolicyInput } from "@/lib/api/followups";

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type TimeResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * The time a person typed for a touch, as an ISO time with an offset: EMPTY means NOW (null: the database clock stamps it); a typed time (a browser's "date and time" field, read as India time)
 * is refused when it is after `now`. Never a future time.
 */
export function touchTime(text: string, now: Date): TimeResult {
  const value = text.trim();
  if (value === "") return { ok: true, value: null };
  const m = LOCAL.exec(value);
  if (!m) return { ok: false, error: "Enter the date and time as the form shows it, or leave it empty for now." };
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // The wall-clock fields must survive a round trip: 30 February or 25:00 would otherwise roll over into another day.
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d || wall.getUTCHours() !== h || wall.getUTCMinutes() !== mi)
    return { ok: false, error: "That date and time do not exist." };
  const at = new Date(wall.getTime() - 5.5 * 3600 * 1000);
  if (at.getTime() > now.getTime()) return { ok: false, error: "A touch cannot be in the future. Leave the time empty for now." };
  return { ok: true, value: at.toISOString() };
}

/** The India date-and-time now, in the form a "date and time" field takes (its `max`: never the future). */
export function indiaNowLocal(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
}

export function parseGapDays(text: string): number[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    out.push(Number(p));
  }
  return out.every((n) => n <= 365) ? out : null;
}

export function parseHolidays(text: string): string[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const seen = new Set<string>();
  for (const p of parts) {
    if (!DAY.test(p) || Number.isNaN(Date.parse(`${p}T00:00:00Z`)) || new Date(`${p}T00:00:00Z`).toISOString().slice(0, 10) !== p || seen.has(p)) return null;
    seen.add(p);
  }
  return [...seen].sort();
}

export type PolicyResult = { ok: true; input: PolicyInput } | { ok: false; error: string };

/** The policy a person typed. The database checks every rule again (and refuses a gap count that is not max touches - 1); this only turns text into the typed body. */
export function policyFromForm(values: Record<string, string>, weekdays: string[], id: string): PolicyResult {
  const maxTouches = /^\d{1,3}$/.test(values.max_touches ?? "") ? Number(values.max_touches) : NaN;
  if (!(maxTouches >= 1 && maxTouches <= 100)) return { ok: false, error: "Enter how many touches at most, from 1 to 100." };
  const gaps = parseGapDays(values.gap_days ?? "");
  if (gaps === null) return { ok: false, error: "Enter the days to wait between touches as whole numbers, for example 3, 7, 14." };
  if (gaps.length !== maxTouches - 1) return { ok: false, error: `With ${maxTouches} touches you need ${maxTouches - 1} gaps (the days to wait before touches 2 to ${maxTouches}).` };
  const start = (values.quiet_start ?? "").trim();
  const end = (values.quiet_end ?? "").trim();
  if (!TIME.test(start) || !TIME.test(end) || start === end) return { ok: false, error: "Enter two different times for the quiet hours, for example 21:00 and 09:00." };
  const days = weekdays.map((d) => (/^[0-6]$/.test(d) ? Number(d) : NaN));
  if (days.length === 0 || days.some(Number.isNaN) || new Set(days).size !== days.length) return { ok: false, error: "Choose at least one weekday." };
  const holidays = parseHolidays(values.holidays ?? "");
  if (holidays === null) return { ok: false, error: "Enter holidays as dates like 2026-12-25, separated by commas or lines." };
  const minGap = /^\d{1,4}$/.test(values.min_gap_hours ?? "") ? Number(values.min_gap_hours) : NaN;
  if (!(minGap >= 0 && minGap <= 8760)) return { ok: false, error: "Enter the minimum gap in hours, from 0 to 8760." };
  const offset = /^-?\d{1,3}$/.test(values.offset_minutes ?? "") ? Number(values.offset_minutes) : NaN;
  if (!(offset >= -840 && offset <= 840)) return { ok: false, error: "Enter the recipient's UTC offset in minutes, for example 330 for India." };
  const from = (values.effective_from ?? "").trim();
  if (!DAY.test(from)) return { ok: false, error: "Choose the day the policy starts: today or later." };
  return {
    ok: true,
    input: {
      id,
      effectiveFrom: from,
      gapDays: gaps,
      maxTouches,
      quietStart: start,
      quietEnd: end,
      allowedWeekdays: [...days].sort((a, b) => a - b),
      holidays,
      minGapHours: minGap,
      recipientUtcOffsetMinutes: offset,
    },
  };
}

// ----------------------------------------------------------------------------- which buttons a role is offered for a draft (guidance; the database decides again)
export interface DraftOffers {
  /** Owner or Admin, for a draft waiting for approval. */
  approve: boolean;
  /** The approval needs the authenticator app: shown instead of the button when the session has not used it. */
  approveNeedsSecondFactor: boolean;
  discard: boolean;
  /** "I sent it myself": for an APPROVED draft, Owner, Admin or Sales. */
  sent: boolean;
}
export function draftOffers(draft: Pick<Draft, "status" | "created_by">, role: string, userId: string, aal: string): DraftOffers {
  const strong = role === "owner" || role === "admin";
  const writer = strong || role === "sales";
  const open = draft.status === "draft" || draft.status === "approved";
  return {
    approve: strong && draft.status === "draft",
    approveNeedsSecondFactor: strong && draft.status === "draft" && aal !== "aal2",
    discard: open && (strong || (role === "sales" && draft.created_by === userId)),
    sent: writer && draft.status === "approved",
  };
}

// ----------------------------------------------------------------------------- words
/** The gate and the stop in closed words, one sentence each (empty when nothing blocks). */
export function gateLines(gate: Gate): string[] {
  const lines: string[] = [];
  if (!gate.policy_in_force) lines.push("No follow-up policy is in force: the owner must publish one.");
  if (gate.blocked !== null) lines.push(GATE_TEXT[gate.blocked] ?? "This contact cannot be contacted.");
  if (gate.stopped !== null) lines.push(STOPPED_TEXT[gate.stopped] ?? "Follow-ups are stopped for this lead.");
  return lines;
}

/** What the engine said, in our words, for the page's "guidance only" line. */
export function decisionLine(decision: Decision | null, policyInForce: boolean): string {
  if (decision === null) return policyInForce ? "No guidance could be given right now. You can still ask for a draft: the database decides." : "No guidance: no follow-up policy is in force.";
  const base = DECISION_TEXT[decision.reason_code] ?? DECISION_FALLBACK;
  if (decision.action === "wait" && decision.next_eligible_at) return `${base} Earliest: ${decision.next_eligible_at.slice(0, 16).replace("T", " ")} UTC.`;
  if (decision.action === "draft_followup" && decision.touch_number !== null) return `${base} (This would be touch ${decision.touch_number}.)`;
  return base;
}

/** One line of the due list in our words (guidance: the database decides again when a draft is asked for). */
export function dueLine(item: Pick<DueItem, "action" | "reason_code" | "touch_number" | "next_eligible_at">): string {
  const base = DECISION_TEXT[item.reason_code] ?? DECISION_FALLBACK;
  if (item.action === "draft_followup") return `${base} (Touch ${item.touch_number}.)`;
  if (item.action === "wait" && item.next_eligible_at) return `${base} Earliest: ${item.next_eligible_at.slice(0, 16).replace("T", " ")} UTC.`;
  return base;
}

// ----------------------------------------------------------------------------- errors
export interface ErrorState {
  error: string;
  /** What is on the screen is out of date: the page is read again (the person sees the new state, never a guess). */
  stale: boolean;
}

/** A refusal of the API as ONE fixed sentence of our own (status, closed code, closed reason). Never the server's text. */
export function errorState(status: number, code: string, reason?: string): ErrorState {
  return { error: followupSentence(status, code, reason), stale: STALE_CODES.includes(code) };
}
