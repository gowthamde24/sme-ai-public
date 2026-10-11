import type { LogFilters } from "@/components/v2/app/outbox/outbox-time";
import type { OutboxTab } from "@/components/v2/app/outbox/reasons";
import type { Role } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getOutboxSettings, getOutboxSummary, listOutboxMessages, type OutboxMessage, type OutboxSettings, type OutboxSummary } from "@/lib/api/outbox";
import { getSchedulerStatus, type SchedulerStatus } from "@/lib/api/scheduler";

const PAGE = 30;

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export type OutboxData = {
  /** null = the list could not be read. The server has already applied the tab, the customer and the dates. */
  items: OutboxMessage[] | null;
  /** The counts behind the four tabs (with the same customer and dates) and what Dispatch would act on; null = could not be read. */
  counts: OutboxSummary | null;
  /** The cursor of the next older page: it keeps the filters. */
  more: string | null;
  settings: OutboxSettings | null;
  scheduler: SchedulerStatus | null;
};

/**
 * What the Outbox page shows (job BE, on BB's server filters): ONE call for the tab's messages (`GET /outbox/messages?tab=&customer=&from=&to=&after=`, newest first, thirty at a time, the cursor keeps the
 * filters), ONE for the counts of the four tabs (`GET /outbox/summary`, the same filters), and, for Owner and Admin, the sending settings (the system switch and the quiet hours) and Agent OWL's status. Nothing is
 * narrowed on the page any more. Each read stands on its own: one that fails is null (the page says so in that place only); a rejected session is thrown.
 */
export async function readOutbox(accessToken: string, tenantId: string, o: { tab: OutboxTab; filters: LogFilters; after: string | null; role: Role }): Promise<OutboxData> {
  const admin = o.role === "owner" || o.role === "admin";
  const f = { ...(o.filters.q ? { customer: o.filters.q } : {}), ...(o.filters.from ? { from: o.filters.from } : {}), ...(o.filters.to ? { to: o.filters.to } : {}) };
  const [page, counts, settings, scheduler] = await Promise.all([
    settle(() => listOutboxMessages(accessToken, tenantId, { tab: o.tab, limit: PAGE, after: o.after, ...f })),
    settle(() => getOutboxSummary(accessToken, tenantId, f)),
    admin ? settle(() => getOutboxSettings(accessToken, tenantId)) : Promise.resolve(null),
    admin ? settle(() => getSchedulerStatus(accessToken, tenantId)) : Promise.resolve(null),
  ]);
  return { items: page === null ? null : page.items, counts, more: page === null ? null : page.next_cursor, settings, scheduler };
}
