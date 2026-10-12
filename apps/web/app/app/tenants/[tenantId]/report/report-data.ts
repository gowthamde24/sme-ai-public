import { ApiAuthError } from "@/lib/api/client";
import { listCatalogueItems, type ItemSummary } from "@/lib/api/catalogue";
import { getOutboxSummary, listOutboxMessages, type OutboxMessage } from "@/lib/api/outbox";
import { getAiUsageWeek, listVisits } from "@/lib/api/visits";
import { approvalFigure, sareeFigures, visitFigures, weekRange, type Part, type ReportData, type WeekRange } from "@/lib/report/week";

/** At most this many pages of sent messages (100 each) and catalogue pages (50 each) are read for the week. */
const MESSAGE_PAGES = 3;
const CATALOGUE_PAGES = 4;

async function settle<T>(read: () => Promise<T>): Promise<Part<T>> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return "error";
  }
}

async function sentMessages(accessToken: string, tenantId: string, range: WeekRange): Promise<{ items: OutboxMessage[]; capped: boolean }> {
  const items: OutboxMessage[] = [];
  let after: string | null = null;
  for (let page = 0; page < MESSAGE_PAGES; page += 1) {
    const got = await listOutboxMessages(accessToken, tenantId, { tab: "sent", from: range.from, to: range.to, limit: 100, after });
    items.push(...got.items);
    after = got.next_cursor;
    if (!after) return { items, capped: false };
  }
  return { items, capped: true };
}

async function catalogueCovers(accessToken: string, tenantId: string): Promise<ItemSummary[]> {
  const items: ItemSummary[] = [];
  let after: string | null = null;
  for (let page = 0; page < CATALOGUE_PAGES; page += 1) {
    const got = await listCatalogueItems(accessToken, tenantId, { limit: 50, includeInactive: true, after });
    items.push(...got.items);
    after = got.next_cursor;
    if (!after) break;
  }
  return items;
}

/**
 * "This week" (job BV): the India week, Monday to Sunday, made only from reads the app already has (visits of the range, the Outbox counts and sent messages of the range, the catalogue's cover photos, the weekly AI
 * figure), each on its own with the person's own token. A part that fails says so alone; a rejected session is passed on. Nothing is stored and no words of a message leave this function: only counts.
 */
export async function readReport(accessToken: string, tenantId: string, now: number): Promise<ReportData> {
  const range = weekRange(now);
  const [visits, summary, sent, ai] = await Promise.all([
    settle(async () => visitFigures((await listVisits(accessToken, tenantId, { from: range.from, to: range.to })).items, range)),
    settle(async () => {
      const s = await getOutboxSummary(accessToken, tenantId, { from: range.from, to: range.to });
      return { sent: s.sent, waiting: s.waiting, blocked: s.blocked };
    }),
    settle(() => sentMessages(accessToken, tenantId, range)),
    settle(async () => (await getAiUsageWeek(accessToken, tenantId)).week_percent),
  ]);
  const approval: ReportData["approval"] = sent === "error" ? "error" : approvalFigure(sent.items);
  let sarees: ReportData["sarees"] = "error";
  if (sent !== "error") {
    if (sent.items.some((m) => m.media.length > 0)) {
      const items = await settle(() => catalogueCovers(accessToken, tenantId));
      sarees = items === "error" ? "error" : { ...sareeFigures(sent.items, items), capped: sent.capped };
    } else {
      sarees = { top: [], unmatched: 0, withPhotos: 0, capped: sent.capped };
    }
  }
  return { range, visits, messages: summary, approval, sarees, aiPercent: ai };
}
