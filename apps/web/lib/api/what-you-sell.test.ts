import { readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseItem } from "@/lib/api/catalogue";
import { itemJson, pageJson, summaryJson } from "@/lib/api/catalogue-fixtures";
import { wireSell, wireUnderstood } from "@/lib/sell/fixtures";
import { PACK_STYLE, liveSource, oldPagesOf, styleOfPack } from "@/lib/sell/style";
import { SELL_STYLES } from "@/lib/sell/types";

import { parseCourse, parsePrice, parseProduct, parseProperty, parseSellList, parseService, parseStyleWord, productOf, readUnderstood, readWhatYouSell, stockOf } from "./what-you-sell";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: request }));

const TENANT = "22222222-2222-2222-2222-222222222222";
beforeEach(() => request.mockReset());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the fixtures (the approved mock's list) go through the SAME parsers", () => {
  it.each(SELL_STYLES)("%s: every row of the fixture is read, none left out, nothing logged", (style) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rows = (wireSell(style).items as unknown[]).length;
    const entries = parseSellList(wireSell(style), style);
    expect(entries).toHaveLength(rows);
    expect(entries.every((e) => e.style === style)).toBe(true);
    expect(err).not.toHaveBeenCalled();
  });
  it("the made-up readings of photos and a sheet are in the same shapes, with ids of their own", () => {
    for (const style of SELL_STYLES) for (const from of ["photos", "sheet"] as const) {
      const rows = parseSellList(wireUnderstood(style, from), style);
      expect(rows.length, `${style} ${from}`).toBeGreaterThan(0);
      expect(rows.every((r) => r.id.startsWith("5e110006"))).toBe(true);
    }
  });
  it("the mock's words: four products (one sold out), four services, three courses, three properties, three price items", () => {
    const by = (s: (typeof SELL_STYLES)[number]) => parseSellList(wireSell(s), s);
    const products = by("products") as ReturnType<typeof parseProduct>[];
    expect(products.map((p) => [p.name, p.pricePaise, p.stock.state, p.stock.count])).toEqual([
      ["Kanjivaram silk saree", 850_000, "in_stock", 4],
      ["Mysore silk saree", 520_000, "in_stock", 12],
      ["Pochampally ikat cotton", 145_000, "few_left", 2],
      ["Brocade blouse piece", 65_000, "sold_out", 0],
    ]);
    expect(by("services").map((s) => s.name)).toEqual(["Haircut", "Facial", "Hair spa", "Bridal makeup"]);
    expect(by("courses")).toHaveLength(3);
    expect(by("properties").map((p) => (p as ReturnType<typeof parseProperty>).status)).toEqual(["available", "booked", "sold"]);
    const price = by("pricelist")[0] as ReturnType<typeof parsePrice>;
    expect(price.rates.map((r) => [r.fromQty, r.ratePaise])).toEqual([[50, 11_800], [200, 11_000], [500, 10_400]]);
  });
});

describe("products are rows of the REAL catalogue contract", () => {
  const row = (over: Record<string, unknown> = {}) => summaryJson(over);
  it("a row the catalogue's own parser refuses (a colour that is not in its list) is refused here too", () => {
    expect(() => parseProduct(row({ colours: ["teal"] }))).toThrow();
    expect(() => parseProduct(row({ stock_status: "plenty" }))).toThrow();
  });
  it("the catalogue's fields are kept for the save (the whole item is sent back), and the photo is the cover's", () => {
    const p = parseProduct(row({ fabric: "banarasi", zari: "rich", border: "Gold", occasions: ["wedding"], active: false }));
    expect(p.keep).toEqual({ fabric: "banarasi", zari: "rich", border: "Gold", occasions: ["wedding"], active: false });
    expect(p.photo).toContain("_t.jpg");
    expect(parseProduct(row({}) && summaryJson({}, null)).photo).toBeNull();
  });
  it("stock_count is the one field the catalogue lacks: absent = unknown, 0 = sold out, a bad number is refused", () => {
    expect(parseProduct(row()).stock).toEqual({ state: "in_stock", count: null });
    expect(parseProduct(row({ stock_count: 0 })).stock.state).toBe("sold_out");
    expect(parseProduct(row({ stock_status: "few_left", stock_count: 2 })).stock).toEqual({ state: "few_left", count: 2 });
    expect(() => parseProduct(row({ stock_count: -1 }))).toThrow();
    expect(stockOf("made_to_order", null)).toBe("made_to_order");
  });
  it("productOf takes any catalogue row (an item read on its own has no cover)", () => {
    expect(productOf(parseItem(itemJson())).name).toBe("DEMO Maroon Kanchi pattu");
  });
});

describe("closed words: a row that does not fit is LEFT OUT and logged, a list that does not fit is an error", () => {
  it("a service with a booking word the web does not know is left out; the others stay", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rows = [...(wireSell("services").items as Record<string, unknown>[])];
    rows[1] = { ...rows[1], booking: "whenever" };
    const out = parseSellList({ style: "services", items: rows }, "services");
    expect(out.map((e) => e.name)).toEqual(["Haircut", "Hair spa", "Bridal makeup"]);
    expect(err).toHaveBeenCalledTimes(1);
  });
  it("each style has its own closed words", () => {
    const f = (s: (typeof SELL_STYLES)[number]) => (wireSell(s).items as Record<string, unknown>[])[0];
    expect(() => parseService({ ...f("services"), place: "moon" })).toThrow();
    expect(() => parseCourse({ ...f("courses"), seats: { state: "plenty", count: 3 } })).toThrow();
    expect(() => parseCourse({ ...f("courses"), seats: { state: "left", count: null } })).toThrow();
    expect(() => parseProperty({ ...f("properties"), status: "rented" })).toThrow();
    expect(() => parseProperty({ ...f("properties"), size_unit: "marla" })).toThrow();
    expect(() => parsePrice({ ...f("pricelist"), unit: "bale" })).toThrow();
  });
  it("rates of a price item go up in quantity and never up in price, and there is at least one", () => {
    const item = (rates: unknown) => ({ ...(wireSell("pricelist").items as Record<string, unknown>[])[0], rates });
    expect(() => parsePrice(item([]))).toThrow();
    expect(() => parsePrice(item([{ from_qty: 50, rate_paise: 100 }, { from_qty: 50, rate_paise: 90 }]))).toThrow();
    expect(() => parsePrice(item([{ from_qty: 50, rate_paise: 100 }, { from_qty: 200, rate_paise: 120 }]))).toThrow();
  });
  it("the answer must be for the style asked, and must be a list", () => {
    expect(() => parseSellList(wireSell("courses"), "services")).toThrow();
    expect(() => parseSellList({ style: "services", items: "none" }, "services")).toThrow();
    expect(() => parseSellList({ style: "pizza", items: [] }, "services")).toThrow();
  });
  it("a style word the web does not know is ignored (the pack map decides)", () => {
    expect(parseStyleWord("services")).toBe("services");
    expect(parseStyleWord("rentals")).toBeNull();
    expect(styleOfPack("textiles", "rentals")).toBe("products");
    expect(styleOfPack("textiles", "services")).toBe("services");
  });
});

describe("the style of a business follows its pack (ONE closed map, until C1 adds the field)", () => {
  const PACKS = path.resolve(import.meta.dirname, "../../../../packages/packs");
  const ids = readdirSync(PACKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  it("every pack on main has a style (a new pack must be added to lib/sell/style.ts)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids.filter((id) => !Object.hasOwn(PACK_STYLE, id))).toEqual([]);
  });
  it("the planner's choices: wholesale = price lists; real estate = properties; schools and coaching = courses; clinics, gyms, insurance, interiors and solar, travel = services; the rest = products", () => {
    expect(styleOfPack("wholesale_b2b")).toBe("pricelist");
    expect(styleOfPack("real_estate")).toBe("properties");
    expect([styleOfPack("education"), styleOfPack("coaching")]).toEqual(["courses", "courses"]);
    expect(["clinic", "gym", "insurance_loans", "interiors_solar", "travel"].map((p) => styleOfPack(p))).toEqual(Array(5).fill("services"));
    expect(["textiles", "construction_materials", "auto_dealer", "general_business"].map((p) => styleOfPack(p))).toEqual(Array(4).fill("products"));
    expect([styleOfPack(null), styleOfPack("brand_new_pack")]).toEqual(["products", "products"]);
  });
  it("the real data comes from what exists: the saree catalogue, the loaded price list, the programmes; the rest waits for C1", () => {
    expect(liveSource("products", ["catalogue", "quotes"])).toBe("catalogue");
    expect(liveSource("products", ["catalogue", "materials"])).toBeNull();
    expect(liveSource("pricelist", ["quotes"])).toBe("price_list");
    expect(liveSource("courses", ["programmes"])).toBe("programmes");
    expect([liveSource("services", ["catalogue"]), liveSource("properties", ["quotes"]), liveSource("pricelist", [])]).toEqual([null, null, null]);
  });
  it("the old pages stay one link away: the style's own, and for a business that quotes the price list too", () => {
    expect(oldPagesOf("products", ["catalogue", "quotes"], false)).toEqual([{ path: "/catalogue", word: "old" }, { path: "/price-list", word: "old_prices" }]);
    expect(oldPagesOf("services", ["catalogue"], false)).toEqual([]);
    expect(oldPagesOf("courses", ["programmes"], false)).toEqual([{ path: "/programmes", word: "old" }]);
    expect(oldPagesOf("pricelist", [], true)).toEqual([{ path: "/price-list", word: "old" }]);
  });
});

describe("what the section reads (readWhatYouSell)", () => {
  it("JOBS off: nothing is read", async () => {
    expect(await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true)).toEqual({ state: "off" });
    expect(request).not.toHaveBeenCalled();
  });
  it("JOBS=mock: the made-up list, marked as not live, and nothing leaves the server", async () => {
    vi.stubEnv("JOBS", "mock");
    const r = await readWhatYouSell("tok", TENANT, "services", null, true);
    expect(r.state === "ready" && r.data.live).toBe(false);
    expect(r.state === "ready" ? r.data.entries : []).toHaveLength(4);
    expect(request).not.toHaveBeenCalled();
  });
  it("a real saree shop reads its catalogue (hidden sarees too: the Owner and Admin keep them)", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce(pageJson());
    const r = await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true);
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/catalogue/items?limit=50&include_inactive=true"), "tok");
    expect(r.state === "ready" && r.data.live).toBe(true);
    expect(r.state === "ready" ? r.data.entries.length : 0).toBe(4);
    expect(r.state === "ready" && r.data.cut).toBeUndefined();
  });
  it("Sales and Viewer do not ask for the switched-off items", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce(pageJson());
    await readWhatYouSell("tok", TENANT, "products", ["catalogue"], false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain("/catalogue/items?limit=50");
    expect(request.mock.calls[0][0]).not.toContain("include_inactive");
  });
  it("more than 50 items: the next pages are followed by their cursor, up to 200; a longer list is cut and says so", async () => {
    vi.stubEnv("JOBS", "1");
    const row = (n: number) => summaryJson({ id: `c27a36f2-ef14-5f33-b10f-${String(n).padStart(12, "0")}` });
    const rows = (from: number) => Array.from({ length: 50 }, (_, i) => row(from + i));
    request.mockResolvedValueOnce(pageJson(rows(0), "c1")).mockResolvedValueOnce(pageJson(rows(50), null));
    const two = await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true);
    expect(two.state === "ready" ? two.data.entries.length : 0).toBe(100);
    expect(two.state === "ready" && two.data.cut).toBeUndefined();
    expect(request.mock.calls[1][0]).toContain("after=c1");
    request.mockReset();
    request.mockResolvedValueOnce(pageJson(rows(0), "c1")).mockResolvedValueOnce(pageJson(rows(50), "c2")).mockResolvedValueOnce(pageJson(rows(100), "c3")).mockResolvedValueOnce(pageJson(rows(150), "c4"));
    const cut = await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true);
    expect(request).toHaveBeenCalledTimes(4);
    expect(cut.state === "ready" ? cut.data.entries.length : 0).toBe(200);
    expect(cut.state === "ready" && cut.data.cut).toBe(true);
  });
  it("a style with no API yet is `unready` (never a guess), and a read that fails is `unread`", async () => {
    vi.stubEnv("JOBS", "1");
    expect(await readWhatYouSell("tok", TENANT, "properties", ["quotes"], true)).toEqual({ state: "unready" });
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(new Error("down"));
    expect(await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true)).toEqual({ state: "unread" });
  });
  it("the made-up reading of photos or a sheet exists in test mode only", async () => {
    expect(await readUnderstood("products", "photos")).toBeNull();
    vi.stubEnv("JOBS", "mock");
    expect(await readUnderstood("products", "photos")).toHaveLength(2);
    expect(await readUnderstood("pricelist", "sheet")).toHaveLength(2);
  });
});
