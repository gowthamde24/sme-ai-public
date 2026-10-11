import { filedAt, inRange, type Range } from "@/components/v2/app/outbox/outbox-time";
import { TAB_STATUSES, type OutboxTab } from "@/components/v2/app/outbox/reasons";
import type { Role } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getOutboxSettings, listOutboxMessages, type OutboxMessage, type OutboxSettings } from "@/lib/api/outbox";
import { getSchedulerStatus, type SchedulerStatus } from "@/lib/api/scheduler";

const PAGE = 100;

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export type OutboxData = {
  /** null = the list could not be read. Already narrowed to the range and the customer search. */
  items: OutboxMessage[] | null;
  /** How many wait for a person (null = could not be read); 100 = "100 or more". */
  waiting: number | null;
  /** The cursor of the next older page (single-status tabs only). */
  more: string | null;
  settings: OutboxSettings | null;
  scheduler: SchedulerStatus | null;
};

/** Customer search: part of the name or the city, ignoring case and accents of case only. The words of a message are NOT searched (they are a person's to read, not to scan). */
export function matches(m: OutboxMessage, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return `${m.customer ?? ""} ${m.city ?? ""}`.toLowerCase().includes(needle);
}

/**
 * What the Outbox page shows: one tab's messages (`GET /outbox/messages?status=`, newest first, a hundred at a time; Blocked reads blocked and failed), narrowed to the range and to the customer searched for, how many wait for
 * a person, and, for Owner and Admin, the sending settings (the system switch) and Agent OWL's status. Each read stands on its own: one that fails is null (the page says so in that place only); a rejected session is thrown.
 */
export async function readOutbox(accessToken: string, tenantId: string, o: { tab: OutboxTab; range: Range; q: string; after: string | null; role: Role; now: number }): Promise<OutboxData> {
  const statuses = TAB_STATUSES[o.tab];
  const admin = o.role === "owner" || o.role === "admin";
  const [pages, waiting, settings, scheduler] = await Promise.all([
    settle(() => Promise.all(statuses.map((status) => listOutboxMessages(accessToken, tenantId, { status, limit: PAGE, after: statuses.length === 1 ? o.after : null })))),
    o.tab === "waiting" ? Promise.resolve(null) : settle(async () => (await listOutboxMessages(accessToken, tenantId, { status: "needs_approval", limit: PAGE })).items.length),
    admin ? settle(() => getOutboxSettings(accessToken, tenantId)) : Promise.resolve(null),
    admin ? settle(() => getSchedulerStatus(accessToken, tenantId)) : Promise.resolve(null),
  ]);
  const all = pages === null ? null : pages.flatMap((p) => p.items).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const items = all === null ? null : all.filter((m) => inRange(filedAt(m), o.range, o.now) && matches(m, o.q));
  return {
    items,
    waiting: o.tab === "waiting" ? (all === null ? null : all.length) : waiting,
    more: pages !== null && statuses.length === 1 ? pages[0].next_cursor : null,
    settings,
    scheduler,
  };
}
