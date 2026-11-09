import type { OutboxMessage, OutboxPage } from "@/lib/api/outbox";
import type { CallRow } from "@/lib/api/calls";
import type { ActivityEntry } from "@/lib/assistant-work/types";

/**
 * "Everything it did" (app v4 part 8, owner 9 Nov 2026): ONE timeline of what the assistant did, merged here from the sources that exist (its tool actions with their Undo, its calls, the messages it wrote), the last 7 days, at most 50 from
 * each source, newest first. Each source is one function that gives entries (lib/everything/source.ts), so the day C1 builds a server-side `/activity-log` it is one more source in the list and the three here go. Nothing is made up: a
 * row says what the API said (an action's own summary, a call's name and outcome, a message's customer and state); an Undo is offered only for an action whose API entry says it can be undone.
 */
export const KINDS = ["calls", "messages", "changes"] as const;
export type Kind = (typeof KINDS)[number];
export type Entry = {
  /** unique across sources */
  id: string;
  kind: Kind;
  at: string;
  /** a word key of the page's own words for the row's heading and what is filled into it */
  key: string;
  vars: Record<string, string>;
  /** a short line of the API's own words (an action's summary, a call's summary), or null */
  detail: string | null;
  /** inside the workspace, relative to its base ("/calls/…"), or null */
  href: string | null;
  /** an action that can be undone now: its id; null = no Undo */
  undo: string | null;
  /** "done", "failed", "undone" for an action; null for the others */
  outcome: "done" | "failed" | "undone" | null;
};
export const WINDOW_DAYS = 7;
export const PER_SOURCE = 50;

export function fromAction(a: ActivityEntry): Entry {
  return { id: `a:${a.actionId}`, kind: "changes", at: a.at, key: "ev.change", vars: { what: a.summary }, detail: a.changed, href: null, undo: a.status === "done" && a.undo === "available" ? a.actionId : null, outcome: a.status };
}
export function fromCall(c: CallRow): Entry {
  return { id: `c:${c.id}`, kind: "calls", at: c.answeredAt ?? c.createdAt, key: c.refuseReason ? "ev.call.refused" : c.direction === "inbound" ? "ev.call.in" : "ev.call.out", vars: { who: c.who }, detail: c.summaryShort, href: `/calls/${c.id}`, undo: null, outcome: null };
}
export function fromMessage(m: OutboxMessage): Entry {
  const at = m.sent_at ?? m.decided_at ?? m.created_at;
  return { id: `m:${m.id}`, kind: "messages", at, key: `ev.msg.${m.status}`, vars: { who: m.customer ?? "" }, detail: null, href: `/outbox`, undo: null, outcome: null };
}
export const messagesOf = (page: OutboxPage): OutboxMessage[] => page.items.filter((m) => m.source !== "owner");

/** The merged timeline: only the last 7 days, at most 50 of each kind (the newest), newest first. A source that failed contributes nothing and is said by the caller ("Not shown yet"). */
export function merge(sources: readonly (readonly Entry[])[], now: number): Entry[] {
  const since = now - WINDOW_DAYS * 86_400_000;
  const out: Entry[] = [];
  for (const s of sources) {
    const mine = s.filter((e) => Date.parse(e.at) >= since && Date.parse(e.at) <= now + 3_600_000).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    out.push(...mine.slice(0, PER_SOURCE));
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
