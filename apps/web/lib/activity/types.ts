/**
 * "Live now" (owner 31 Oct): what the assistant is doing at this moment, from the API's `GET /v1/tenants/{id}/assistant/activity` (C1's contract): ONE item per piece of real, in-flight work (a call in progress, a WhatsApp reply or a follow-up
 * in the last minute, a quote drafted, a lead read), no counts. The strip groups them by type ("On a call with Ramesh", "Replying on WhatsApp · 3 chats", "Reading 2 new leads"); nothing in the list means "All caught up". Everything is checked as it
 * arrives; what cannot be read is dropped (a strip that says something wrong is worse than one that says less). `who` is the API's display name (a name, else "Number ending 1234", else "New enquiry": never an id; null for a Viewer).
 */
export const ACTIVITY_TYPES = ["call", "whatsapp_reply", "lead_read", "follow_up", "quote_draft"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityTarget = { kind: "task" | "conversation" | "lead" | "quote"; id: string };
export type ActivityItem = { type: ActivityType; who: string | null; /** Seconds since it began, as the API counted them when it answered. */ elapsedS: number; target: ActivityTarget | null };
export type ActivityFeed = { items: ActivityItem[]; /** How soon the API would like to be asked again. */ pollAfterS: number | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const who = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= 60 ? v.trim() : null);

/** The feed of an activity answer (at most 20 items, in the API's priority order); null when the answer is not an activity answer at all. */
export function parseActivity(json: unknown): ActivityFeed | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  const items: ActivityItem[] = [];
  for (const raw of json.items.slice(0, 20)) {
    if (!isRec(raw) || !(ACTIVITY_TYPES as readonly unknown[]).includes(raw.type)) continue;
    const tg = isRec(raw.target) ? raw.target : null;
    const kind = tg && (tg.kind === "task" || tg.kind === "conversation" || tg.kind === "lead" || tg.kind === "quote") ? tg.kind : null;
    const t: ActivityTarget | null = tg && kind && typeof tg.id === "string" && UUID.test(tg.id) ? { kind, id: tg.id } : null;
    const elapsed = typeof raw.elapsed_s === "number" && Number.isFinite(raw.elapsed_s) && raw.elapsed_s >= 0 ? Math.min(Math.round(raw.elapsed_s), 86_400) : 0;
    items.push({ type: raw.type as ActivityType, who: who(raw.who), elapsedS: elapsed, target: t });
  }
  const poll = typeof json.poll_after_s === "number" && Number.isFinite(json.poll_after_s) ? Math.min(Math.max(json.poll_after_s, 3), 60) : null;
  return { items, pollAfterS: poll };
}

/** The feed as the API writes it (snake_case), which is what the app's own route sends to the browser: the browser reads it with `parseActivity` like the server does. */
export function activityWire(feed: ActivityFeed): { items: { type: ActivityType; who: string | null; elapsed_s: number; target: ActivityTarget | null }[]; poll_after_s: number | null } {
  return { items: feed.items.map((i) => ({ type: i.type, who: i.who, elapsed_s: i.elapsedS, target: i.target })), poll_after_s: feed.pollAfterS };
}

/** One line of the strip: the items of one kind of work. */
export type ActivityRow = { key: "call" | "chats" | "followups" | "quote" | "leads"; count: number; who: string | null; elapsedS: number; /** Where a tap goes (inside the workspace): the one thing it is about, else the list. */ href: (base: string) => string };

const ORDER: ActivityRow["key"][] = ["call", "chats", "followups", "quote", "leads"];
const KEY: Record<ActivityType, ActivityRow["key"]> = { call: "call", whatsapp_reply: "chats", follow_up: "followups", quote_draft: "quote", lead_read: "leads" };

/** The strip's lines: calls first, then the chats the assistant is answering, the follow-ups it is sending, quotes, leads. A tap opens the call, chat, quote or lead when there is exactly one, else the list. */
export function groupActivity(items: readonly ActivityItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const key of ORDER) {
    const mine = items.filter((i) => KEY[i.type] === key);
    if (mine.length === 0) continue;
    const first = mine[0];
    const only = mine.length === 1 ? first.target : null;
    const href = (base: string): string => {
      if (key === "call") return only?.kind === "task" ? `${base}/tasks/${only.id}` : `${base}/tasks`;
      if (key === "chats") return only?.kind === "conversation" ? `${base}/chats/${only.id}` : `${base}/chats`;
      if (key === "followups") return `${base}/outbox`;
      if (key === "quote") return only?.kind === "quote" ? `${base}/quotes/${only.id}` : `${base}/quotes`;
      return only?.kind === "lead" ? `${base}/leads/${only.id}` : `${base}/lead-desk`;
    };
    rows.push({ key, count: mine.length, who: first.who, elapsedS: first.elapsedS, href });
  }
  return rows;
}
