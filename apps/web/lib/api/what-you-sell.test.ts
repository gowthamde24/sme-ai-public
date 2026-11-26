import { readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseItem } from "@/lib/api/catalogue";
import { itemJson, pageJson, summaryJson } from "@/lib/api/catalogue-fixtures";
import { wireSell, wireUnderstood } from "@/lib/sell/fixtures";
import { PACK_STYLE, liveSource, oldPagesOf, styleOfPack } from "@/lib/sell/style";
import { SELL_STYLES } from "@/lib/sell/types";

import { ApiRequestError } from "./client";
import { parseProductsReading, parseCourse, parsePrice, parseProduct, parseProperty, parseSellList, parseSellPage, parseSellReading, parseService, parseStyleWord, productOf, putSellEntry, readSellDrafts, readUnderstood, readWhatYouSell, removeSellEntry, stockOf, wireOfEntry } from "./what-you-sell";

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
  it("a read that fails is `unread`; a session that is refused is not hidden as `not ready`", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockRejectedValueOnce(new Error("down"));
    expect(await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true)).toEqual({ state: "unread" });
    request.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "no"));
    expect(await readWhatYouSell("tok", TENANT, "services", ["catalogue"], true)).toEqual({ state: "unread" });
    request.mockRejectedValueOnce(new ApiRequestError(500, "boom", "no"));
    expect(await readWhatYouSell("tok", TENANT, "properties", [], true)).toEqual({ state: "unread" });
  });
  it("products with no catalogue module are `unready`, with no call", async () => {
    vi.stubEnv("JOBS", "1");
    expect(await readWhatYouSell("tok", TENANT, "products", ["materials"], true)).toEqual({ state: "unready" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("GET /what-you-sell?style=&limit=50&cursor= (contract 1.1 part 1, W2): ONLY a 404 means not there yet", () => {
  const rowsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `5e110002-0000-4000-8000-${String(from + i).padStart(12, "0")}`, name: `Service ${from + i}`, minutes: 30, price_paise: 20_000, price_from: false, booking: "any_day", place: null }));
  beforeEach(() => vi.stubEnv("JOBS", "1"));
  it("asks with the style, 50 an answer and no cursor first; the answer's items are the list", async () => {
    request.mockResolvedValueOnce({ style: "services", items: rowsOf(3), next_cursor: null });
    const r = await readWhatYouSell("tok", TENANT, "services", [], true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`/v1/tenants/${TENANT}/what-you-sell?style=services&limit=50`);
    expect(r.state === "ready" ? r.data.entries.length : 0).toBe(3);
    expect(r.state === "ready" && r.data.live).toBe(true);
  });
  it("follows next_cursor for up to 4 answers = 200 items, and a longer list is cut and says so", async () => {
    request.mockResolvedValueOnce({ style: "services", items: rowsOf(50), next_cursor: "a" }).mockResolvedValueOnce({ style: "services", items: rowsOf(50, 50), next_cursor: "b" }).mockResolvedValueOnce({ style: "services", items: rowsOf(50, 100), next_cursor: "c" }).mockResolvedValueOnce({ style: "services", items: rowsOf(50, 150), next_cursor: "d" });
    const r = await readWhatYouSell("tok", TENANT, "services", [], true);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[1][0]).toBe(`/v1/tenants/${TENANT}/what-you-sell?style=services&limit=50&cursor=a`);
    expect(r.state === "ready" ? r.data.entries.length : 0).toBe(200);
    expect(r.state === "ready" && r.data.cut).toBe(true);
  });
  it("a style that is not the workspace's is an empty list, never an error", async () => {
    request.mockResolvedValueOnce({ style: "properties", items: [], next_cursor: null });
    const r = await readWhatYouSell("tok", TENANT, "properties", [], true);
    expect(r).toMatchObject({ state: "ready", data: { entries: [], live: true } });
  });
  it("404 = not there yet: a business with no old route stands in is `unready`", async () => {
    request.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no"));
    expect(await readWhatYouSell("tok", TENANT, "properties", ["quotes"], true)).toEqual({ state: "unready" });
  });
  it("404 = not there yet: courses fall back to the programmes, price lists to the loaded price list (the old routes)", async () => {
    request.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no")).mockResolvedValueOnce({ programmes: [] });
    const r = await readWhatYouSell("tok", TENANT, "courses", ["programmes"], true);
    expect(request.mock.calls[1][0]).toContain("/programmes");
    expect(r.state).toMatch(/ready|unread/);
  });
  it("403 (a real refusal), 5xx and an answer for another style are NOT 'not there yet': the section says it could not read", async () => {
    for (const refusal of [new ApiRequestError(403, "forbidden", "no"), new ApiRequestError(503, "down", "no"), new ApiRequestError(501, "nope", "no")]) {
      request.mockReset();
      request.mockRejectedValueOnce(refusal);
      expect(await readWhatYouSell("tok", TENANT, "courses", ["programmes"], true)).toEqual({ state: "unread" });
      expect(request).toHaveBeenCalledTimes(1);
    }
    request.mockReset();
    request.mockResolvedValueOnce({ style: "courses", items: [], next_cursor: null });
    expect(await readWhatYouSell("tok", TENANT, "services", [], true)).toEqual({ state: "unread" });
  });
  it("the page parser: the style named, items, a short next_cursor or null; services minutes 5..1440 or null", () => {
    expect(parseSellPage({ style: "services", items: rowsOf(1), next_cursor: "x" }, "services").next).toBe("x");
    expect(() => parseSellPage({ style: "services", items: [], next_cursor: "" }, "services")).toThrow();
    expect(() => parseSellPage({ style: "services", items: [], next_cursor: 5 }, "services")).toThrow();
    const one = (minutes: unknown) => parseSellPage({ style: "services", items: [{ ...rowsOf(1)[0], minutes }], next_cursor: null }, "services").entries.length;
    expect([one(5), one(1440), one(null)]).toEqual([1, 1, 1]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect([one(4), one(1441)]).toEqual([0, 0]);
  });
  it("the shapes of the contract: courses description (<=200) and seats {open|left|full} with count only with left; properties note (<=200); money whole paise", () => {
    const course = (over: Record<string, unknown>) => ({ id: "5e110003-0000-4000-8000-000000000001", name: "X", batch: "Mon", starts_on: null, fee_paise: 100, seats: { state: "open" }, total: null, ...over });
    expect(parseCourse(course({ description: "Daily tests" })).description).toBe("Daily tests");
    expect(() => parseCourse(course({ description: "x".repeat(201) }))).toThrow();
    expect(parseCourse(course({ seats: { state: "full" } })).seats).toEqual({ state: "full", count: null });
    expect(() => parseCourse(course({ seats: { state: "left", count: 0 } }))).toThrow();
    const prop = (over: Record<string, unknown>) => ({ id: "5e110004-0000-4000-8000-000000000001", name: "Plot", location: "X", size: 1, size_unit: "sq_yd", note: null, price_paise: 100, status: "available", ...over });
    expect(parseProperty(prop({ note: "n".repeat(200) })).note).toHaveLength(200);
    expect(() => parseProperty(prop({ note: "n".repeat(201) }))).toThrow();
    expect(() => parseProperty(prop({ price_paise: 10.5 }))).toThrow();
    expect(() => parseService({ ...rowsOf(1)[0], name: "n".repeat(121) })).toThrow();
  });
});

describe("the writes: PUT /what-you-sell/{style}/{id} and POST .../remove", () => {
  const entry = parseSellList({ style: "services", items: [{ id: "5e110002-0000-4000-8000-000000000001", name: "Haircut", minutes: 30, price_paise: 20_000, price_from: true, booking: "not_sunday", place: "at_home" }] }, "services")[0];
  it("sends the whole entry as the wire shape, without the id (it is in the path), with PUT", async () => {
    request.mockResolvedValueOnce({});
    const out = await putSellEntry("tok", TENANT, entry);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/what-you-sell/services/${entry.id}`, "tok", { method: "PUT", body: JSON.stringify({ name: "Haircut", minutes: 30, price_paise: 20_000, price_from: true, booking: "not_sunday", place: "at_home" }) });
    expect(out).toEqual(entry);
  });
  it("the answer is used when it is the stored entry", async () => {
    request.mockResolvedValueOnce({ id: entry.id, name: "Haircut", minutes: 30, price_paise: 25_000, price_from: true, booking: "not_sunday", place: "at_home" });
    expect(await putSellEntry("tok", TENANT, entry)).toMatchObject({ pricePaise: 25_000 });
  });
  it("each style's wire form uses the contract's names", () => {
    const e = (s: (typeof SELL_STYLES)[number], i = 0) => parseSellList(wireSell(s), s)[i];
    expect(wireOfEntry(e("courses"))).toEqual({ name: "NEET crash course", batch: "Mon to Fri, 6 pm", starts_on: "2026-12-02", fee_paise: 2_400_000, seats: { state: "left", count: 6 }, total: 30, description: "Daily tests and a doubt class every Saturday" });
    expect(wireOfEntry(e("courses", 2))).toMatchObject({ seats: { state: "full" } });
    expect(wireOfEntry(e("properties"))).toEqual({ name: "2 BHK flat", location: "Kukatpally", size: 1150, size_unit: "sq_ft", note: "3rd floor", price_paise: 680_000_000, status: "available" });
    expect(wireOfEntry(e("pricelist"))).toMatchObject({ moq: 50, unit: "metre", rates: [{ from_qty: 50, rate_paise: 11_800 }, { from_qty: 200, rate_paise: 11_000 }, { from_qty: 500, rate_paise: 10_400 }], good_until: "2026-12-31" });
  });
  it("products are never sent here (style=products is refused by the API: the catalogue routes are theirs)", async () => {
    const product = parseSellList(wireSell("products"), "products")[0];
    await expect(putSellEntry("tok", TENANT, product)).rejects.toThrow();
    await expect(removeSellEntry("tok", TENANT, "products", entry.id)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("remove is a POST (the API has no DELETE), for an id that is a UUID", async () => {
    request.mockResolvedValueOnce({});
    await removeSellEntry("tok", TENANT, "services", entry.id);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/what-you-sell/services/${entry.id}/remove`, "tok", { method: "POST", body: "{}" });
    await expect(removeSellEntry("tok", TENANT, "services", "x")).rejects.toThrow();
  });
});

describe("the reading call: POST /what-you-sell/{style}/read", () => {
  const FILE = "5e110009-0000-4000-8000-0000000000cc";
  it("talk sends the words (at most 2000) and the language of the owner's words; a photo or sheet sends the file id", async () => {
    request.mockResolvedValue({ style: "services", drafts: [], unclear: true, notes: [] });
    await readSellDrafts("tok", TENANT, "services", { kind: "talk", text: "haircut 200" }, "te");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${TENANT}/what-you-sell/services/read`, "tok", { method: "POST", body: JSON.stringify({ kind: "talk", text: "haircut 200", language: "te" }) });
    await readSellDrafts("tok", TENANT, "services", { kind: "sheet", fileId: FILE }, "xx");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${TENANT}/what-you-sell/services/read`, "tok", { method: "POST", body: JSON.stringify({ kind: "sheet", file_id: FILE, language: "en" }) });
    await readSellDrafts("tok", TENANT, "services", { kind: "talk", text: "x".repeat(2500) }, "hi");
    expect(JSON.parse(request.mock.lastCall![2].body).text).toHaveLength(2000);
    await expect(readSellDrafts("tok", TENANT, "services", { kind: "photo", fileId: "nope" }, "en")).rejects.toThrow();
    await expect(readSellDrafts("tok", TENANT, "products", { kind: "talk", text: "abc" }, "en")).rejects.toThrow();
  });
  it("drafts: an id is given by the web, a draft without a price has price null (never guessed), notes are plain codes", () => {
    const out = parseSellReading({ style: "services", drafts: [{ name: "Haircut", minutes: 30, price_paise: 20_000, price_from: false, booking: "any_day", place: null }, { name: "Facial", minutes: null, price_paise: null, price_from: false, booking: "any_day", place: null }], unclear: false, notes: [{ code: "price_missing", row: 2 }, { code: "too_many" }, { code: "mystery", row: 1 }, { code: "unreadable", row: 99 }] }, "services");
    expect(out.entries.map((e) => [e.name, e.style === "services" ? e.pricePaise : "x"])).toEqual([["Haircut", 20_000], ["Facial", null]]);
    expect(new Set(out.entries.map((e) => e.id)).size).toBe(2);
    expect(out.entries[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.notes).toEqual([{ code: "price_missing", row: 2 }, { code: "too_many", row: null }, { code: "unreadable", row: null }]);
  });
  it("at most 20 drafts; the answer must be for the style asked; a draft that does not fit is left out", () => {
    const row = { name: "X", minutes: 30, price_paise: 100, price_from: false, booking: "any_day", place: null };
    expect(() => parseSellReading({ style: "services", drafts: Array.from({ length: 21 }, () => row), unclear: false, notes: [] }, "services")).toThrow();
    expect(() => parseSellReading({ style: "courses", drafts: [], unclear: false, notes: [] }, "services")).toThrow();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseSellReading({ style: "services", drafts: [row, { name: "", minutes: 30 }], unclear: false, notes: [] }, "services").entries).toHaveLength(1);
  });
  it("the other styles' drafts: properties and price items without a price, a missing unit is the plain one", () => {
    const p = parseSellReading({ style: "properties", drafts: [{ name: "Plot", location: "Shamshabad", size: 200, price_paise: null }], unclear: false, notes: [{ code: "price_missing", row: 1 }] }, "properties");
    expect(p.entries[0]).toMatchObject({ style: "properties", pricePaise: null, sizeUnit: "sq_ft", status: "available" });
    const w = parseSellReading({ style: "pricelist", drafts: [{ name: "Towel", moq: 12, rates: [{ from_qty: 12, rate_paise: null }] }, { name: "Shirting", unit: "metre", moq: 50, rates: [{ from_qty: 50, rate_paise: 11_800 }] }], unclear: false, notes: [{ code: "unit_missing", row: 1 }] }, "pricelist");
    expect(w.entries[0]).toMatchObject({ unit: "piece", rates: [] });
    expect(w.entries[1]).toMatchObject({ unit: "metre", rates: [{ fromQty: 50, ratePaise: 11_800 }] });
    const c = parseSellReading({ style: "courses", drafts: [{ name: "Maths", fee_paise: null }], unclear: false, notes: [] }, "courses");
    expect(c.entries[0]).toMatchObject({ style: "courses", feePaise: null, seats: { state: "open" } });
  });
});

describe("products: stock_count (null = not counted, 0 = sold out, n = n in stock)", () => {
  it("the catalogue row's stock_count is read by the catalogue parser (lenient) and used for the product", () => {
    const item = (extra: Record<string, unknown>) => productOf(parseItem(itemJson(extra)));
    expect(item({}).stock.count).toBeNull();
    expect(item({ stock_count: 7 }).stock).toEqual({ state: "in_stock", count: 7 });
    expect(item({ stock_count: 0 }).stock).toEqual({ state: "sold_out", count: 0 });
    expect(item({ stock_count: -3 }).stock.count).toBeNull();
    expect(item({ stock_count: "many" }).stock.count).toBeNull();
    expect(item({ stock_status: "few_left", stock_count: null }).stock).toEqual({ state: "few_left", count: null });
  });
  it("the real list shows the counts the API sends", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce(pageJson([summaryJson({ stock_count: 4 }), summaryJson({ id: "c27a36f2-ef14-5f33-b10f-000000000002", stock_count: 0 })], null));
    const r = await readWhatYouSell("tok", TENANT, "products", ["catalogue"], true);
    expect(r.state === "ready" ? r.data.entries.map((e) => (e.style === "products" ? [e.stock.state, e.stock.count] : null)) : []).toEqual([["in_stock", 4], ["sold_out", 0]]);
  });
});

describe("the pack answer's sell_style replaces the closed map when it is there (W1)", () => {
  it("a style the pack answer names wins over the map; an unknown word or none = the map", () => {
    expect(styleOfPack("textiles", "services")).toBe("services");
    expect(styleOfPack("gym", undefined)).toBe("services");
    expect(styleOfPack("brand_new_pack", "courses")).toBe("courses");
    expect(styleOfPack("brand_new_pack", "rentals")).toBe("products");
  });
});

describe("(kept) the made-up reading and the old rules", () => {
  it("the made-up reading of photos or a sheet exists in test mode only", async () => {
    expect(await readUnderstood("products", "photos")).toBeNull();
    vi.stubEnv("JOBS", "mock");
    expect(await readUnderstood("products", "photos")).toHaveLength(2);
    expect(await readUnderstood("pricelist", "sheet")).toHaveLength(2);
  });
});

describe("the products reading answer (C1, 26 Nov 2026)", () => {
  it("keeps every draft with its confidence; an unknown confidence word is 'low', never 'high'; a draft with no name is dropped", () => {
    const r = parseProductsReading({
      style: "products",
      drafts: [
        { name: "Kanchi pattu", price_paise: 2_450_000, unit: "piece", notes: null, confidence: "high" },
        { name: "Soft silk", price_paise: null, unit: null, notes: "price smudged", confidence: "medium" },
        { name: "Cotton", price_paise: 400_000, confidence: "very sure" },
        { name: "  ", price_paise: 1, confidence: "high" },
        { name: "Neg", price_paise: -5, confidence: "high" },
      ],
      unclear: false,
      notes: [{ code: "price_missing", row: 2 }, { code: "too_many" }, { code: "nonsense", row: 1 }],
      read_by: "ai_vision",
      pages: 2,
    });
    expect(r.drafts.map((d) => [d.name, d.pricePaise, d.confidence])).toEqual([["Kanchi pattu", 2_450_000, "high"], ["Soft silk", null, "medium"], ["Cotton", 400_000, "low"], ["Neg", null, "high"]]);
    expect(r.drafts[1].notes).toBe("price smudged");
    expect(r.notes).toEqual([{ code: "price_missing", row: 2 }, { code: "too_many", row: null }]);
    expect([r.readBy, r.pages, r.unclear]).toEqual(["ai_vision", 2, false]);
  });
  it("is strict about the answer's own shape", () => {
    expect(() => parseProductsReading(null)).toThrow();
    expect(() => parseProductsReading({ drafts: "x" })).toThrow();
  });
});

