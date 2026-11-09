import type { LogItem } from "@/lib/api/activity-log";
import type { ActivityEntry } from "@/lib/assistant-work/types";

/**
 * "Everything it did" (app v4 part 8, owner 9 Nov 2026): ONE timeline of what the assistant did, the last 7 days, at most 50 from each kind, newest first. It comes from C1's own `GET /activity-log` (lib/api/activity-log.ts); each source is
 * still one function that gives entries (lib/everything/source.ts), so it stays swappable. Nothing is made up: a row says what the API said (an action's own summary, a call's name and summary, a message's contact and state); an Undo is
 * offered only for an action whose API entry says it can be undone now.
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
  /** inside the workspace, relative to its base ("/calls/..."), or null */
  href: string | null;
  /** an action that can be undone now: its id; null = no Undo */
  undo: string | null;
  /** "done", "failed", "undone" for an action; null for the others */
  outcome: "done" | "failed" | "undone" | null;
  /** a practice or test-line call */
  practice?: boolean;
};
export const WINDOW_DAYS = 7;
export const PER_SOURCE = 50;

/** An assistant action as the made-up day (ASSISTANT_WORK_SCREENS=mock) has it. */
export function fromAction(a: ActivityEntry): Entry {
  return { id: `a:${a.actionId}`, kind: "changes", at: a.at, key: "ev.change", vars: { what: a.summary }, detail: a.changed, href: null, undo: a.status === "done" && a.undo === "available" ? a.actionId : null, outcome: a.status };
}

const MESSAGE_STATES = ["queued", "needs_approval", "sent", "blocked", "failed"];
/** A row of the API's own timeline: the page's own links are used, never the API's (`href` there is informative only). Undo only where the API says it is "available". */
export function fromLog(i: LogItem): Entry {
  if (i.kind === "action") {
    return { id: `a:${i.id}`, kind: "changes", at: i.at, key: "ev.change", vars: { what: i.summary ?? "" }, detail: null, href: null, undo: i.undo === "available" && i.status === "done" ? i.id : null, outcome: i.status === "failed" || i.status === "undone" ? i.status : "done" };
  }
  if (i.kind === "call") {
    return { id: `c:${i.id}`, kind: "calls", at: i.at, key: i.refused ? "ev.call.refused" : i.direction === "inbound" ? "ev.call.in" : "ev.call.out", vars: { who: i.contactName ?? "" }, detail: i.summary, href: `/calls/${i.id}`, undo: null, outcome: null, practice: i.sandbox };
  }
  return { id: `m:${i.id}`, kind: "messages", at: i.at, key: `ev.msg.${i.status && MESSAGE_STATES.includes(i.status) ? i.status : "queued"}`, vars: { who: i.contactName ?? "" }, detail: null, href: i.leadId ? `/leads/${i.leadId}` : "/outbox", undo: null, outcome: null };
}

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
