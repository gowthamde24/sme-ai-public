import type { CampaignOut, ResultsOut } from "@contracts";

import type { Status } from "@/components/v2/app/ds/StatusPill";
import type { BatchAnswer, Policy } from "@/lib/outreach/types";

/**
 * The cards of the Campaigns page (design system v6): the calling and WhatsApp lists of Lead Desk (batches, `/outreach`) and the reminder campaigns of a business type (`/campaigns`) as ONE kind of card with a state, a progress bar and results. Pure: no request, no React.
 */
export const CARD_STATES = ["draft", "planned", "running", "paused", "done", "stopped"] as const;
export type CardState = (typeof CARD_STATES)[number];
export type CardKind = "list" | "reminder";
export type CardChannel = "call" | "whatsapp" | "both";
export type CardResults = { /** Visits the list booked; null when the API does not say yet. */ visits: number | null; /** What the quotes made from the list add up to, in paise; null when not said. */ quotesPaise: number | null; /** People who showed interest. */ interested: number | null; /** What was paid after a reminder, in paise (reminder campaigns). */ paidPaise: number | null };
export type CampaignCard = {
  id: string;
  kind: CardKind;
  name: string;
  channel: CardChannel;
  /** The lead goal of a list (site_visit, quote...), null for a reminder. */
  goal: string | null;
  state: CardState;
  /** A paused list: the owner paused it (they can undo it), or a limit did (calls, minutes, billing). */
  pausedBy: "owner" | "limit" | null;
  done: number;
  total: number;
  /** The people in it that will be tried (a list's `ready`), or the recipients of a reminder campaign. */
  people: number;
  /** For a list that waits for an OK: the numbers to estimate (calls, average minutes of a call). */
  forEstimate: { calls: number; avgMinutes: number; estimatedMinutes: number; estimatedCostPaise: number } | null;
  results: CardResults;
  href: string;
};

/** The colours are the design system's six status colours (no new ones): waiting for the OK blue, running purple, paused orange, done green, stopped red, a draft grey. */
export const CARD_STATUS: Record<CardState, Status> = { draft: "no_answer", planned: "transferred", running: "live", paused: "spam", done: "completed", stopped: "rejected" };

const BATCH_STATE: Record<string, CardState> = { planned: "planned", running: "running", paused: "paused", done: "done", cancelled: "stopped" };

export function cardFromBatch(a: BatchAnswer, base: string): CampaignCard {
  const { batch, plan, progress } = a;
  const calls = batch.channel === "whatsapp" ? 0 : plan.ready;
  const total = progress?.total ?? plan.ready;
  return {
    id: batch.id,
    kind: "list",
    name: batch.name,
    channel: batch.channel,
    goal: batch.goal,
    state: BATCH_STATE[batch.status] ?? "draft",
    pausedBy: batch.status !== "paused" ? null : batch.pausedReason === null || batch.pausedReason === "owner" ? "owner" : "limit",
    done: Math.min(progress?.done ?? 0, total),
    total,
    people: plan.ready,
    forEstimate: batch.status === "planned" && calls > 0 ? { calls, avgMinutes: Math.max(0.5, Math.round((plan.estimatedMinutes / calls) * 10) / 10), estimatedMinutes: plan.estimatedMinutes, estimatedCostPaise: plan.estimatedCostPaise } : null,
    results: { visits: progress?.visitsBooked ?? null, quotesPaise: progress?.quotesPaise ?? null, interested: progress ? progress.interested : null, paidPaise: null },
    href: `${base}/outreach/batches/${batch.id}`,
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const REMINDER_STATE: Record<string, CardState> = { draft: "draft", approved: "planned", running: "running", paused: "paused", done: "done", cancelled: "stopped" };

/** A reminder campaign: its progress is how many of the messages it planned have been sent (or ended: blocked, skipped, failed); what it brought in is what was paid after a reminder. `results` is null when they could not be read. */
export function cardFromReminder(c: CampaignOut, results: ResultsOut | null, base: string): CampaignCard {
  const s = (results?.by_state ?? {}) as Record<string, number>;
  const ended = num(s.sent) + num(s.delivered) + num(s.read) + num(s.blocked) + num(s.skipped) + num(s.failed);
  const left = num(s.planned) + num(s.held);
  const paid = results?.paid_after_reminder as { amount_paise?: number } | undefined;
  return {
    id: c.id,
    kind: "reminder",
    name: c.name,
    channel: "whatsapp",
    goal: null,
    state: REMINDER_STATE[c.status] ?? "draft",
    pausedBy: c.status === "paused" ? "owner" : null,
    done: ended,
    total: ended + left,
    people: c.recipients,
    forEstimate: null,
    results: { visits: null, quotesPaise: null, interested: results ? num(results.replied) : null, paidPaise: results && paid ? num(paid.amount_paise) : null },
    href: `${base}/campaigns/${c.id}`,
  };
}

export type Groups = { waiting: CampaignCard[]; active: CampaignCard[]; finished: CampaignCard[] };
/** Waiting for the owner (plans and drafts), going on (running and paused), and finished (done and stopped), each in the order given. */
export function groupCards(cards: readonly CampaignCard[]): Groups {
  const out: Groups = { waiting: [], active: [], finished: [] };
  for (const c of cards) {
    if (c.state === "draft" || c.state === "planned") out.waiting.push(c);
    else if (c.state === "running" || c.state === "paused") out.active.push(c);
    else out.finished.push(c);
  }
  return out;
}

/** The progress of a card as whole numbers for a bar: never more than the total, and a list with nobody in it is 0 of 0. */
export function progressOf(c: Pick<CampaignCard, "done" | "total">): { value: number; max: number } {
  const max = Math.max(0, Math.floor(c.total));
  return { value: Math.min(Math.max(0, Math.floor(c.done)), max), max };
}

/** "Mon to Sat, 09:00 to 19:00": the days given as 1 (Monday) to 7 (Sunday). Days in a row are "Mon to Sat", others are listed. */
export function hoursLine(hours: Policy["hours"], dayNames: readonly string[], to: string): string {
  const days = [...new Set(hours.days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const name = (d: number) => dayNames[d - 1] ?? String(d);
  let when: string;
  if (days.length === 0) when = "";
  else if (days.length === 1) when = name(days[0]);
  else if (days[days.length - 1] - days[0] === days.length - 1) when = `${name(days[0])} ${to} ${name(days[days.length - 1])}`;
  else when = days.map(name).join(", ");
  return `${when}${when ? ", " : ""}${clock(hours.fromMinute)} ${to} ${clock(hours.toMinute)}`;
}
