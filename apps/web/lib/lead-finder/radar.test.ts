import { describe, expect, it } from "vitest";

import { buildRadar, checkedOf, chipOf, likeThis, suggested } from "./radar";

/** app v4 part 5: the radar's geometry and words, with no browser. Nothing is a guess: only businesses with a position are pins. */
const P = (id: string, lat: number | null, lng: number | null, status = "needs_owner", area: string | null = "Jayanagar") => ({ id, name: `Shop ${id}`, area, status: status as never, lat, lng });

describe("the radar", () => {
  it("is not drawn without two positioned businesses; a business with no position is not a pin", () => {
    expect(buildRadar([])).toBeNull();
    expect(buildRadar([P("a", 12.9, 77.5)])).toBeNull();
    expect(buildRadar([P("a", 12.9, 77.5), P("b", null, null), P("c", 12.9, null)])).toBeNull();
    expect(buildRadar([P("a", 12.9, 77.5), P("b", null, null), P("c", 12.91, 77.51)])?.positioned).toBe(2);
  });
  it("puts the middle of the found businesses in the middle, north up, east right, with real kilometres", () => {
    const r = buildRadar([P("north", 12.95, 77.5), P("south", 12.85, 77.5), P("east", 12.9, 77.55), P("west", 12.9, 77.45)])!;
    const pin = (id: string) => r.pins.find((p) => p.id === id)!;
    expect(pin("north").y).toBeLessThan(0); // up on the screen
    expect(pin("south").y).toBeGreaterThan(0);
    expect(pin("east").x).toBeGreaterThan(0);
    expect(pin("west").x).toBeLessThan(0);
    expect(pin("north").km).toBeCloseTo(5.5, 0); // 0.05 degree of latitude
    expect(pin("east").km).toBeCloseTo(5.4, 0); // 0.05 degree of longitude at 12.9 north
    for (const p of r.pins) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.0001);
  });
  it("rings are thirds of the next round number of kilometres at or above the farthest business", () => {
    const r = buildRadar([P("a", 12.9, 77.5), P("b", 12.9, 77.6)])!; // 5.4 km each side of the middle
    expect(r.outerKm).toBe(10);
    expect(r.rings.map((x) => x.km)).toEqual([3.3, 6.7, 10]);
    const tight = buildRadar([P("a", 12.9, 77.5), P("b", 12.9005, 77.5)])!;
    expect(tight.outerKm).toBe(0.5);
  });
  it("the best few (the list is best fit first) carry their area, the rest are dots; a pin's tone is its decision", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => P(id, 12.9 + i * 0.01, 77.5, i === 0 ? "call_ready" : i === 1 ? "skipped" : "needs_owner", i === 2 ? null : "Basavanagudi"));
    const r = buildRadar(items)!;
    expect(r.pins.filter((p) => p.labelled).map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.pins.find((p) => p.id === "c")?.label).toBe("Shop c"); // no area: its name
    expect(r.pins.map((p) => p.tone).slice(0, 3)).toEqual(["go", "quiet", "ask"]);
  });
});

describe("the words and moves around it", () => {
  it('"Checked N businesses. M worth a call.": everything it looked at; the ready and the waiting for an OK', () => {
    expect(checkedOf({ total: 35, byStatus: { call_ready: 1, needs_owner: 2, skipped: 30 } })).toEqual({ checked: 35, worth: 3 });
    expect(checkedOf({ total: 0, byStatus: {} })).toEqual({ checked: 0, worth: 0 });
    expect(checkedOf(null)).toBeNull();
  });
  it("three decision chips; every other state keeps its own word", () => {
    expect([chipOf("call_ready"), chipOf("needs_owner"), chipOf("skipped"), chipOf("qualified"), chipOf("researching")]).toEqual(["call_ready", "needs_owner", "skipped", "other", "other"]);
  });
  it('"Call all suggested shops" is the ones waiting for the owner\'s OK, nothing else', () => {
    expect(suggested([{ id: "a", status: "needs_owner" }, { id: "b", status: "skipped" }, { id: "c", status: "call_ready" }, { id: "d", status: "needs_owner" }])).toEqual(["a", "d"]);
  });
  it('"Find more like this shop" searches the shop\'s own type in the search\'s area, else its own; a shop with no type has nothing to look for', () => {
    expect(likeThis({ category: "Saree shop", area: "Jayanagar" }, "Bengaluru")).toEqual({ query: "Saree shop", area: "Bengaluru" });
    expect(likeThis({ category: " Boutique ", area: "Kukatpally" }, null)).toEqual({ query: "Boutique", area: "Kukatpally" });
    expect(likeThis({ category: null, area: "Kukatpally" }, "Hyderabad")).toBeNull();
    expect(likeThis({ category: "x", area: "Kukatpally" }, "Hyderabad")).toBeNull();
  });
});
