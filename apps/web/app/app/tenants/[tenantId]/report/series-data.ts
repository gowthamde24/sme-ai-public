import { ApiAuthError } from "@/lib/api/client";
import { listCalls } from "@/lib/api/calls";
import { listLeadArrivals } from "@/lib/api/lead-desk";
import { fetchOrders } from "@/lib/api/orders";
import { listVisits } from "@/lib/api/visits";
import type { Period } from "@/lib/reports-v6/period";
import { callCost, enquiryFigures, heatmap, indiaDay, salesFigures, visitFigures } from "@/lib/reports-v6/series";

/**
 * The day-by-day reads of the design-system-v6 Reports page, each on its own with the person's own token (a part that cannot be read is null and the page says "not available yet" for it; a rejected session is thrown). Nothing is made up:
 * - enquiries: the leads that arrived (their arrival time and source), newest first, as many pages as the period and the period before it need (at most 6 pages of 100);
 * - visits: the visits of both periods; sales from visits: the orders of the visits that ended in a purchase (at most 3 pages of 100 orders);
 * - what the assistant cost: the `cost_paise` the API gives on each call (what the customer pays), over the calls it lists (at most 4 pages of 50);
 * - busiest times: the incoming calls of those same calls, by weekday and hour.
 * SERVER ONLY.
 */
export type SeriesRead = {
  enquiries: ReturnType<typeof enquiryFigures> | null;
  visits: ReturnType<typeof visitFigures> | null;
  sales: ReturnType<typeof salesFigures> | null;
  /** what the calls of the period cost the customer, in paise; null when the API gave no cost */
  callCostPaise: number | null;
  heat: ReturnType<typeof heatmap> | null;
  /** how many calls the busiest-times picture is made from */
  callsRead: number;
  /** a read stopped at its page limit: the numbers are for the newest part of the period */
  capped: boolean;
};

async function settle<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

async function leadsSince(token: string, tenantId: string, from: string): Promise<{ rows: { createdAt: string; source: string | null }[]; capped: boolean }> {
  const rows: { createdAt: string; source: string | null }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 6; page++) {
    const got = await listLeadArrivals(token, tenantId, cursor);
    rows.push(...got.rows);
    cursor = got.nextCursor;
    const oldest = got.rows.length ? indiaDay(got.rows[got.rows.length - 1].createdAt) : "";
    if (!cursor || got.rows.length === 0 || (oldest !== "" && oldest < from)) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export async function readSeriesV6(ctx: { token: string; tenantId: string }, period: Period): Promise<SeriesRead> {
  const { token, tenantId } = ctx;
  const [leads, visits, calls] = await Promise.all([
    settle(() => leadsSince(token, tenantId, period.previous.from)),
    settle(async () => (await listVisits(token, tenantId, { from: period.previous.from, to: period.to })).items),
    settle(async () => {
      const out: Awaited<ReturnType<typeof listCalls>>["items"] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 4; page++) {
        const got = await listCalls(token, tenantId, cursor);
        out.push(...got.items);
        cursor = got.nextCursor;
        const oldest = got.items.length ? indiaDay(got.items[got.items.length - 1].createdAt) : "";
        if (!cursor || got.items.length === 0 || (oldest !== "" && oldest < period.from)) break;
      }
      return out;
    }),
  ]);
  const visitFig = visits ? visitFigures(visits, period) : null;
  // the orders of the visits that bought (their ids come from the visits)
  let sales: SeriesRead["sales"] = null;
  if (visits) {
    const want = new Set(visits.filter((v) => v.outcome === "bought" && v.order_id).map((v) => v.order_id as string));
    const paise = new Map<string, number>();
    if (want.size > 0) {
      await settle(async () => {
        let cursor: string | null = null;
        for (let page = 0; page < 3 && paise.size < want.size; page++) {
          const got = await fetchOrders(token, tenantId, { limit: 100, cursor });
          for (const o of got.items) if (want.has(o.id)) paise.set(o.id, o.order_total_paise);
          cursor = got.next_cursor;
          if (!cursor) break;
        }
      });
    }
    sales = salesFigures(visits, paise, period);
  }
  const callLike = calls ? calls.map((c) => ({ createdAt: c.createdAt, direction: c.direction, costPaise: c.costPaise })) : null;
  return {
    enquiries: leads ? enquiryFigures(leads.rows, period) : null,
    visits: visitFig,
    sales,
    callCostPaise: callLike ? callCost(callLike, period) : null,
    heat: callLike ? heatmap(callLike) : null,
    callsRead: calls?.length ?? 0,
    capped: leads?.capped ?? false,
  };
}
