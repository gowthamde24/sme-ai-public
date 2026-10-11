import { describe, expect, it } from "vitest";

import { COLOURS, FABRICS, OCCASIONS, PRICE_BANDS } from "@/lib/api/catalogue";

import { BAND_WORDS, EMPTY_QUERY, activeFilters, apiFilters, badgesOf, hrefFor, isFiltered, makeCover, moveItem, narrow, narrowsItself, parseQuery, priceOf, rupeesToPaise, soonestExpiry, toggled } from "./catalogue-logic";
import { item, rows } from "./catalogue-test-kit";

const BASE = "/app/tenants/T";

describe("the query in the address", () => {
  it("keeps only words of the closed lists, each once, with the API's limits", () => {
    const q = parseQuery({ q: "  maroon  ", fabric: "soft_silk", colour: "maroon,gold,teal,maroon,red,blue,green", occasion: "wedding,x", band: "5k_10k,free", stock: "few_left" });
    expect(q).toEqual({ q: "maroon", fabric: "soft_silk", colours: ["maroon", "gold", "red", "blue"], occasions: ["wedding"], bands: ["5k_10k"], stock: "few_left" });
    expect(parseQuery({ fabric: "velvet", stock: "all", q: "x".repeat(300) })).toMatchObject({ fabric: null, stock: null });
    expect(parseQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(parseQuery({})).toEqual(EMPTY_QUERY);
  });

  it("round-trips through the address, carrying the customer along", () => {
    const q = parseQuery({ q: "blue", fabric: "soft_silk", colour: "blue,navy", band: "5k_10k", stock: "available", occasion: "party" });
    const href = hrefFor(BASE, q, { lead: "L1", after: "cur" });
    const url = new URL(`http://x${href}`);
    expect(url.pathname).toBe(`${BASE}/catalogue`);
    expect(parseQuery(Object.fromEntries(url.searchParams))).toEqual(q);
    expect(url.searchParams.get("lead")).toBe("L1");
    expect(url.searchParams.get("after")).toBe("cur");
    expect(hrefFor(BASE, EMPTY_QUERY)).toBe(`${BASE}/catalogue`);
  });

  it("a chip turns a choice on or off: one fabric and one stock at a time, several colours, occasions and bands up to their limits", () => {
    let q = toggled(EMPTY_QUERY, "fabric", "soft_silk");
    expect(q.fabric).toBe("soft_silk");
    expect(toggled(q, "fabric", "soft_silk").fabric).toBeNull();
    expect(toggled(q, "fabric", "banarasi").fabric).toBe("banarasi");
    q = toggled(toggled(q, "colour", "red"), "colour", "blue");
    expect(q.colours).toEqual(["red", "blue"]);
    expect(toggled(q, "colour", "red").colours).toEqual(["blue"]);
    for (const c of ["green", "pink", "gold"]) q = toggled(q, "colour", c);
    expect(q.colours).toHaveLength(4);
    expect(toggled(q, "stock", "available").stock).toBe("available");
    expect(toggled(toggled(q, "stock", "available"), "stock", "available").stock).toBeNull();
    expect(toggled(toggled(EMPTY_QUERY, "occasion", "party"), "band", "under_5k")).toMatchObject({ occasions: ["party"], bands: ["under_5k"] });
  });

  it("counts the kinds of filter that are on (the search word is not one)", () => {
    expect(activeFilters(EMPTY_QUERY)).toBe(0);
    expect(activeFilters(parseQuery({ q: "x", fabric: "soft_silk", colour: "red,blue", stock: "few_left" }))).toBe(3);
    expect(isFiltered(parseQuery({ q: "x" }))).toBe(true);
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
  });
});

describe("what the API does and what the page does", () => {
  it("asks the API for fabric, colours, occasions, bands and 'in stock'; hidden items only for Owner and Admin", () => {
    const q = parseQuery({ fabric: "soft_silk", colour: "red,blue", occasion: "party", band: "5k_10k", stock: "available", q: "word" });
    expect(apiFilters(q, false)).toEqual({ fabric: "soft_silk", colours: ["red", "blue"], occasions: ["party"], priceBands: ["5k_10k"], inStock: true });
    expect(apiFilters(q, true)).toMatchObject({ includeInactive: true });
    expect(apiFilters(parseQuery({ stock: "made_to_order" }), false)).toEqual({});
    expect(apiFilters(parseQuery({ stock: "few_left" }), false)).toEqual({ inStock: true });
  });

  it("narrows by itself for a name search and for 'few left' or 'made to order' (the API cannot)", () => {
    expect(narrowsItself(parseQuery({ q: "a" }))).toBe(true);
    expect(narrowsItself(parseQuery({ stock: "few_left" }))).toBe(true);
    expect(narrowsItself(parseQuery({ stock: "made_to_order" }))).toBe(true);
    expect(narrowsItself(parseQuery({ stock: "available", fabric: "soft_silk" }))).toBe(false);
  });

  it("searches name, border and fabric; every word must be there; letters and accents do not matter", () => {
    const all = rows();
    const names = (q: string) => narrow(all, parseQuery({ q })).map((i) => i.name);
    expect(names("kanchi")).toEqual(["DEMO Maroon Kanchi pattu"]);
    expect(names("TEMPLE gold")).toEqual(["DEMO Maroon Kanchi pattu"]);
    expect(names("silk peacock")).toEqual(["DEMO Soft silk in peacock blue"]);
    expect(names("zzz")).toEqual([]);
    expect(names("").length).toBe(4);
  });

  it("picks 'few left' and 'made to order' from what was read", () => {
    const all = rows();
    expect(narrow(all, parseQuery({ stock: "few_left" })).map((i) => i.stock_status)).toEqual(["few_left"]);
    expect(narrow(all, parseQuery({ stock: "made_to_order" })).map((i) => i.stock_status)).toEqual(["made_to_order"]);
    expect(narrow(all, parseQuery({ stock: "available" }))).toHaveLength(4);
  });
});

describe("badges and prices", () => {
  it("a hidden item is marked first, then 'few left' or 'made to order'; an ordinary item has none", () => {
    expect(badgesOf({ active: false, stock_status: "few_left" })).toEqual(["inactive", "few_left"]);
    expect(badgesOf({ active: true, stock_status: "made_to_order" })).toEqual(["made_to_order"]);
    expect(badgesOf({ active: true, stock_status: "in_stock" })).toEqual([]);
  });

  it("shows the exact price when the Owner set one, else the band as the API words it", () => {
    expect(priceOf(rows()[0])).toBe("₹38,500.00");
    expect(priceOf(rows()[1])).toBe("₹5,000 to ₹10,000");
  });

  it("has words for every band, in English, with the rupee sign (money stays English)", () => {
    for (const b of PRICE_BANDS) expect(BAND_WORDS[b]).toMatch(/₹/);
  });

  it("reads rupees typed by a person into paise, refusing anything that is not a plain amount of ₹1 to ₹10,00,000", () => {
    expect(rupeesToPaise("38,500")).toBe(3_850_000);
    expect(rupeesToPaise("₹ 1499.50")).toBe(149_950);
    expect(rupeesToPaise("1")).toBe(100);
    expect(rupeesToPaise("1000000")).toBe(100_000_000);
    for (const bad of ["", "0", "0.5", "1000001", "12.345", "abc", "-5", "1e5", "10,00,00,000"]) expect(rupeesToPaise(bad), bad).toBeNull();
  });
});

describe("moving a photo", () => {
  it("moves one place to another and keeps the rest in order; out-of-range moves are clamped or ignored", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, -4)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("making a cover is moving to the front, without touching the input", () => {
    const list = ["a", "b", "c"];
    expect(makeCover(list, 2)).toEqual(["c", "a", "b"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("when the photo links run out", () => {
  it("is the shortest life of any link on the page; nothing to refresh when there is no photo", () => {
    expect(soonestExpiry([item()])).toBe(600);
    expect(soonestExpiry([item({}, [])])).toBeNull();
    expect(soonestExpiry(rows())).toBe(600);
    expect(soonestExpiry([])).toBeNull();
  });
});

describe("the vocabulary has words in every language", () => {
  it("every fabric, colour and occasion has a string in English, Telugu, Hindi and Kannada", async () => {
    const { appDict } = await import("@/i18n/app");
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const dict = appDict(lang) as Record<string, string>;
      for (const f of FABRICS) expect(dict[`catalogue.fabric.${f}`], `${lang} ${f}`).toBeTruthy();
      for (const c of COLOURS) expect(dict[`catalogue.colour.${c}`], `${lang} ${c}`).toBeTruthy();
      for (const o of OCCASIONS) expect(dict[`catalogue.occasion.${o}`], `${lang} ${o}`).toBeTruthy();
      for (const k of ["none", "light", "rich"]) expect(dict[`catalogue.zari.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of ["in_stock", "few_left", "made_to_order", "available"]) expect(dict[`catalogue.stock.${k}`], `${lang} ${k}`).toBeTruthy();
    }
  });
});
