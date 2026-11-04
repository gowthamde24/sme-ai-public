import { describe, expect, it } from "vitest";

import { facts, stockOf } from "./ProspectList";

const t = (key: string, vars?: Record<string, string | number>) => (key === "lf.reviews" ? `${vars?.n} reviews` : key);

describe("the Prospects list says the stock once and each card its own facts (owner, 4 Nov)", () => {
  it("stockOf: each in-stock item once, the most often matched first, then by name; at most eight", () => {
    const m = (matched: string[]) => ({ stockMatch: { matched, low: [], enough: true } });
    expect(stockOf([m(["Kanchi Pattu Bridal", "Soft Silk Daily"]), m(["Soft Silk Daily"]), m(["Dharmavaram Silk Classic"]), { stockMatch: null }])).toEqual(["Soft Silk Daily", "Dharmavaram Silk Classic", "Kanchi Pattu Bridal"]);
    expect(stockOf([])).toEqual([]);
    expect(stockOf([m(Array.from({ length: 12 }, (_, i) => `Saree ${String(i).padStart(2, "0")}`))])).toHaveLength(8);
  });
  it("facts: what, where, the rating and the reviews; missing ones are left out", () => {
    expect(facts({ category: "Saree shop", area: "Jayanagar", rating: 4.5, reviewCount: 1312 }, t)).toBe("Saree shop · Jayanagar · ★ 4.5 · 1,312 reviews");
    expect(facts({ category: null, area: "Basavanagudi", rating: null, reviewCount: null }, t)).toBe("Basavanagudi");
    expect(facts({ category: null, area: null, rating: null, reviewCount: null }, t)).toBe("");
  });
});
