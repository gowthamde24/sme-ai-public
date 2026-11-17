import { describe, expect, it } from "vitest";

import type { NeedsCard, TodayData } from "@/components/v2/app/today/types";

import { overdueFirst } from "./today-data";

const promise = (id: string, neededBy: string | null, at = "2026-11-17T08:00:00Z"): NeedsCard => ({ type: "promise", key: `price-ask-${id}`, at, id, kind: "price", item: "x", customer: "A", neededBy, chatHref: null });
const other = (id: string): NeedsCard => ({ type: "call", key: `call-${id}`, at: "2026-11-17T09:00:00Z", id, customer: "B", city: null, request: null });
const data = (needs: NeedsCard[] | null) => ({ needs }) as unknown as TodayData;

describe("overdue first (owner, 17 Nov)", () => {
  it("puts a promise whose day has passed at the top, the oldest deadline first; the rest keep their order", () => {
    const out = overdueFirst(data([other("1"), promise("a", "2026-11-18"), promise("b", "2026-11-10"), other("2"), promise("c", "2026-11-06"), promise("d", null)]), "2026-11-17");
    expect(out.needs?.map((c) => c.key)).toEqual(["price-ask-c", "price-ask-b", "call-1", "price-ask-a", "call-2", "price-ask-d"]);
  });
  it("a deadline of today is not overdue; nothing overdue leaves the list as it is; an unread list stays unread", () => {
    const d = data([other("1"), promise("a", "2026-11-17")]);
    expect(overdueFirst(d, "2026-11-17")).toBe(d);
    expect(overdueFirst(data(null), "2026-11-17").needs).toBeNull();
  });
});
