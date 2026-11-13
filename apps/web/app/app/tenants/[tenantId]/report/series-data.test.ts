import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ orders: vi.fn(), visits: vi.fn() }));
vi.mock("@/lib/api/calls", () => ({ listCalls: async () => ({ items: [], nextCursor: null }) }));
vi.mock("@/lib/api/lead-desk", () => ({ listLeadArrivals: async () => ({ rows: [], nextCursor: null }) }));
vi.mock("@/lib/api/orders", () => ({ fetchOrders: (...a: unknown[]) => h.orders(...a) }));
vi.mock("@/lib/api/visits", () => ({ listVisits: (...a: unknown[]) => h.visits(...a) }));

import { periodOf } from "@/lib/reports-v6/period";
import { readSeriesV6 } from "./series-data";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  h.orders.mockReset();
  h.visits.mockReset();
});

describe("sales from visits (the orders of the visits that bought)", () => {
  it("reads orders in pages of at most 50 (the API refuses more) and counts the sales", async () => {
    const period = periodOf({}, Date.parse("2026-11-14T10:00:00Z"));
    const day = period.days[3];
    h.visits.mockResolvedValue({ items: [{ id: "v1", date: day, status: "done", outcome: "bought", order_id: "o1" }] });
    h.orders.mockImplementation(async (_t: string, _id: string, o: { limit: number }) => {
      if (o.limit > 50) throw new Error("422");
      return { items: [{ id: "o1", order_total_paise: 1250000 }], next_cursor: null };
    });
    const out = await readSeriesV6({ token: "tok", tenantId: T }, period);
    expect(h.orders).toHaveBeenCalledWith("tok", T, expect.objectContaining({ limit: 50 }));
    expect(out.sales).toMatchObject({ total: 1250000, missing: 0 });
  });
});
