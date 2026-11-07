import { describe, expect, it } from "vitest";

import { groupPlaces } from "./places";

/** app v4 part 5: Customers > Map is a list of real places; nothing is looked up or guessed. */
const BASE = "/app/tenants/t";
const lead = (id: string, name: string, city: string | null, area: string | null = null) => ({ id, name, profile: city === null && area === null ? null : { city, area } });

describe("the places customers are in", () => {
  it("groups by city whatever the capital letters and spaces, the biggest first, and links each customer to their page", () => {
    const r = groupPlaces([lead("a", "Meena", "Guntur", "Brodipet"), lead("b", "Lakshmi", " guntur "), lead("c", "Ravi", "Vijayawada", "Benz Circle")], [], BASE);
    expect(r.places.map((p) => [p.city, p.entries.length])).toEqual([["Guntur", 2], ["Vijayawada", 1]]);
    expect(r.places[0].entries.map((e) => e.name)).toEqual(["Lakshmi", "Meena"]);
    expect(r.places[0].entries.find((e) => e.name === "Meena")).toMatchObject({ kind: "customer", line: "Brodipet, Guntur", href: `${BASE}/customers/a` });
    expect(r.customers).toBe(3);
  });
  it("a customer who gave no city is counted, never placed", () => {
    const r = groupPlaces([lead("a", "Meena", null), lead("b", "Ravi", ""), { id: "c", name: "Anita" }, lead("d", "Lakshmi", "Guntur")], [], BASE);
    expect(r.withoutPlace).toBe(3);
    expect(r.customers).toBe(1);
    expect(r.places).toHaveLength(1);
  });
  it("a site is placed by its own address (the city, the address line, the PIN); one with no address is left out", () => {
    const r = groupPlaces([lead("a", "Meena", "Guntur")], [{ id: "s1", name: "Lake Road site", address_line: "12 Lake Road", city: "Guntur", pin: "522001" }, { id: "s2", name: "No address", address_line: null, city: null, pin: null }, { id: "s3", name: "Only a line", address_line: "Plot 4, NH16", city: null, pin: null }], BASE);
    expect(r.sites).toBe(2);
    const guntur = r.places.find((p) => p.key === "guntur")!;
    expect(guntur.entries.map((e) => [e.kind, e.name, e.line, e.href])).toEqual([["customer", "Meena", "Guntur", `${BASE}/customers/a`], ["site", "Lake Road site", "12 Lake Road, Guntur 522001", null]]);
    expect(r.places.map((p) => p.city)).toContain("Plot 4, NH16");
  });
  it("the CRM's own customers (companies marked as customers) are placed by their city; a supplier or a company with no city is not", () => {
    const r = groupPlaces([lead("a", "Meena", "Guntur")], [], BASE, [{ id: "c1", name: "Lakshmi Textiles", type: "customer", city: "Guntur" }, { id: "c2", name: "A supplier", type: "supplier", city: "Chennai" }, { id: "c3", name: "No city", type: "customer", city: null }, { id: "c4", name: "A prospect", type: "prospect", city: "Tenali" }]);
    expect(r.places.map((p) => [p.city, p.entries.map((e) => e.name)])).toEqual([["Guntur", ["Lakshmi Textiles", "Meena"]]]);
    expect(r.places[0].entries.find((e) => e.name === "Lakshmi Textiles")?.href).toBe(`${BASE}/companies/c1`);
    expect(r.customers).toBe(2);
  });
  it("long free text is cut, and an empty list is an empty answer", () => {
    expect(groupPlaces([lead("a", "N".repeat(300), "C".repeat(300))], [], BASE).places[0].city).toHaveLength(80);
    expect(groupPlaces([], [], BASE)).toEqual({ places: [], customers: 0, withoutPlace: 0, sites: 0 });
  });
});
