import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { makeT } from "@/components/v2/app/words";
import { entryText, minutesText } from "@/components/v2/app/sell/sell-text";
import { parseSellList } from "@/lib/api/what-you-sell";

import { wireSell } from "./fixtures";
import { EMPTY, bandOfPaise, buildEntry, buildPrice, buildProduct, formOf, productSaveInput, rupeesOf } from "./forms";
import { understand } from "./say";
import { bigMoneyText, countNumber, parseBigMoney, shortDay, wholeNumber } from "./text";
import { SELL_STYLES, type ProductEntry, type SellForm } from "./types";

const t = makeT(Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.sell.") || k.startsWith("catalogue.colour."))));
const entries = (s: (typeof SELL_STYLES)[number]) => parseSellList(wireSell(s), s);

describe("numbers and money, the way an owner says them", () => {
  it("rupees: 8,500 / 8500.50 / ₹ 8,500; never 0, never more than the catalogue's own limit", () => {
    expect([rupeesOf("8,500"), rupeesOf("₹ 8500.50"), rupeesOf("0"), rupeesOf("12345678"), rupeesOf("abc"), rupeesOf("")]).toEqual([850_000, 850_050, null, null, null, null]);
  });
  it("a property's price: 68 lakh, 1.2 crore, 6800000, ₹ 24,000", () => {
    expect([parseBigMoney("68 lakh"), parseBigMoney("1.2 crore"), parseBigMoney("₹ 24,000"), parseBigMoney("6800000"), parseBigMoney("lakh"), parseBigMoney("0 lakh")]).toEqual([680_000_000, 1_200_000_000, 2_400_000, 680_000_000, null, null]);
    expect([bigMoneyText(680_000_000), bigMoneyText(1_200_000_000), bigMoneyText(2_400_000_000), bigMoneyText(2_400_000)]).toEqual(["₹68 lakh", "₹1.2 crore", "₹2.4 crore", "₹24,000"]);
  });
  it("whole numbers: 1,150 is fine, 0 is not (a count may be 0), 1.5 is not", () => {
    expect([wholeNumber("1,150"), wholeNumber("0"), wholeNumber("1.5"), countNumber("0"), countNumber("")]).toEqual([1150, null, null, 0, null]);
    expect(shortDay("2026-12-02")).toBe("2 Dec");
    expect(shortDay(null)).toBe("");
  });
  it("the catalogue's price bands", () => {
    expect([499_999, 500_000, 999_999, 1_000_000, 2_499_999, 4_999_999, 5_000_000].map(bandOfPaise)).toEqual(["under_5k", "5k_10k", "5k_10k", "10k_25k", "10k_25k", "25k_50k", "above_50k"]);
  });
});

describe("every entry has its words (the list, the I-understood card and the pictures draw the same lines)", () => {
  it("products: colours, price and a neutral stock chip", () => {
    const x = entries("products").map((e) => entryText(t, e));
    expect(x[0]).toMatchObject({ title: "Kanjivaram silk saree", line: "3 colours · Red, Green, Gold", price: "₹8,500", chip: { tone: "info", text: "4 in stock" } });
    expect(x[2].chip?.text).toBe("2 left");
    expect(x[3].chip?.text).toBe("Sold out");
  });
  it("services, courses, properties: the mock's lines; Booked is amber and Sold is green, the rest neutral", () => {
    expect(entryText(t, entries("services")[3])).toMatchObject({ line: "3 hours · At the shop or at home", price: "from ₹6,000", chip: { text: "Book ahead" } });
    expect(entryText(t, entries("courses")[0])).toMatchObject({ line: "Mon to Fri, 6 pm · starts 2 Dec", price: "₹24,000", chip: { text: "6 seats left" } });
    expect(entryText(t, entries("courses")[2]).chip?.text).toBe("Full");
    const tones = entries("properties").map((e) => entryText(t, e).chip?.tone);
    expect(tones).toEqual(["info", "wait", "done"]);
    expect(entryText(t, entries("properties")[0])).toMatchObject({ title: "2 BHK flat, Kukatpally", line: "1,150 sq ft · 3rd floor", price: "₹68 lakh" });
  });
  it("price lists: the minimum order and the rate by quantity", () => {
    expect(entryText(t, entries("pricelist")[0])).toMatchObject({ line: "Minimum order 50 metres", rates: ["50 m+ ₹118", "200 m+ ₹110", "500 m+ ₹104"] });
    expect(entryText(t, entries("pricelist")[1]).rates).toEqual(["24+ ₹320", "100+ ₹295"]);
    expect([minutesText(t, 30), minutesText(t, 60), minutesText(t, 120)]).toEqual(["30 minutes", "1 hour", "2 hours"]);
  });
});

describe("every style: an entry becomes its form and the form builds the same entry back", () => {
  it.each(SELL_STYLES)("%s", (style) => {
    for (const e of entries(style)) {
      const back = buildEntry(style, e.id, formOf(e), e, true);
      expect(back.ok, `${style} ${e.name}`).toBe(true);
      if (!back.ok) continue;
      // a product keeps what the catalogue keeps; the sold-out chip is a count of 0
      expect(back.entry).toEqual(e);
      if (e.style === "courses") expect(back.entry).toMatchObject({ seats: e.seats });
    }
  });
});

describe("the sheet checks as the owner goes (a code and the field, never a sentence from here)", () => {
  const ok = { ...EMPTY.products, name: "Silk saree", price: "8500", colours: ["red" as const], count: "4" };
  it("products: name, price, one to four colours, a whole count", () => {
    expect(buildProduct("x", ok, null, true).ok).toBe(true);
    expect(buildProduct("x", { ...ok, name: " " }, null, true)).toEqual({ ok: false, code: "name", field: "name" });
    expect(buildProduct("x", { ...ok, price: "lots" }, null, true)).toEqual({ ok: false, code: "price", field: "price" });
    expect(buildProduct("x", { ...ok, colours: [] }, null, true)).toMatchObject({ code: "colours" });
    expect(buildProduct("x", { ...ok, colours: ["red", "blue", "green", "gold", "navy"] }, null, true)).toMatchObject({ code: "colours" });
    expect(buildProduct("x", { ...ok, count: "4.5" }, null, true)).toMatchObject({ code: "count" });
  });
  it("only the Owner's typed price becomes the exact price; an Admin's picks the band; a count of 0 is sold out", () => {
    const owner = buildProduct("x", ok, null, true);
    const admin = buildProduct("x", ok, null, false);
    expect(owner.ok && owner.entry.pricePaise).toBe(850_000);
    expect(admin.ok && admin.entry.pricePaise).toBeNull();
    expect(admin.ok && admin.entry.priceBand).toBe("5k_10k");
    const none = buildProduct("x", { ...ok, count: "0" }, null, true);
    expect(none.ok && none.entry.stock).toEqual({ state: "sold_out", count: 0 });
  });
  it("price lists: rates go up in quantity, never up in price, and start at the smallest order", () => {
    const base = { ...EMPTY.pricelist, name: "Towel", moq: "12", rates: [{ fromQty: "12", rate: "96" }, { fromQty: "60", rate: "88" }] };
    expect(buildPrice("x", base).ok).toBe(true);
    expect(buildPrice("x", { ...base, rates: [{ fromQty: "12", rate: "96" }, { fromQty: "60", rate: "99" }] })).toMatchObject({ code: "rates" });
    expect(buildPrice("x", { ...base, rates: [{ fromQty: "6", rate: "96" }] })).toMatchObject({ code: "rates" });
    expect(buildPrice("x", { ...base, rates: [{ fromQty: "", rate: "" }] })).toMatchObject({ code: "rates" });
    expect(buildPrice("x", { ...base, goodUntil: "31 Dec" })).toMatchObject({ code: "day" });
  });
  it("every other style refuses an empty name and a bad amount", () => {
    for (const s of ["services", "courses", "properties"] as const) expect(buildEntry(s, "x", EMPTY[s], null, true)).toMatchObject({ ok: false, code: "name" });
    expect(buildEntry("services", "x", { ...EMPTY.services, name: "Haircut", price: "x" }, null, true)).toMatchObject({ code: "price" });
    expect(buildEntry("services", "x", { ...EMPTY.services, name: "Haircut", price: "200", minutes: "2" }, null, true)).toMatchObject({ code: "minutes" });
    expect(buildEntry("properties", "x", { ...EMPTY.properties, name: "Plot", location: "Shamshabad", size: "200", price: "1.2 crore" }, null, true).ok).toBe(true);
  });
});

describe("the payload of a product is the OLD catalogue form's, field for field", () => {
  const prior = entries("products")[0] as ProductEntry;
  it("a new saree: the old form's defaults (Kanchi pattu, no zari), not shown until it has a photo, no exact price for an Admin", () => {
    const built = buildProduct("n", { ...EMPTY.products, name: "Red saree", price: "9000", colours: ["red"], stock: "few_left", count: "2" }, null, true);
    if (!built.ok) throw new Error("form");
    expect(productSaveInput(built.entry, true, "9000")).toEqual({ name: "Red saree", fabric: "kanchi_pattu", colours: ["red"], zari: "none", border: null, occasions: [], priceBand: "5k_10k", stockStatus: "few_left", active: false, price: { rupees: 9000 } });
    expect(productSaveInput(built.entry, false, "9000")).not.toHaveProperty("price");
  });
  it("a saree that is changed: what the sheet does not ask (fabric, zari, border, occasions, shown) is sent back as it was, and an empty price keeps the exact price", () => {
    const form = { ...formOf(prior), name: "Kanjivaram silk saree (new)", price: "" };
    const built = buildProduct(prior.id, form, prior, true);
    if (!built.ok) throw new Error("form");
    const sent = productSaveInput(built.entry, true, form.price);
    expect(sent).toEqual({ name: "Kanjivaram silk saree (new)", fabric: "kanchi_pattu", colours: ["red", "green", "gold"], zari: "rich", border: "Green border", occasions: ["festival", "wedding"], priceBand: "5k_10k", stockStatus: "in_stock", active: true });
  });
  it("the same keys the old form's SaveInput has, so a field added to one is caught in the other", () => {
    const built = buildProduct("n", { ...EMPTY.products, name: "A", colours: ["red"] }, null, true);
    if (!built.ok) throw new Error("form");
    expect(Object.keys(productSaveInput(built.entry, false, "")).sort()).toEqual(["active", "border", "colours", "fabric", "name", "occasions", "priceBand", "stockStatus", "zari"]);
  });
});

describe("Say it: closed words and numbers only, nothing sent anywhere", () => {
  it("the mock's own sentence for each style", () => {
    expect(understand("products", "Kanjivaram silk saree, 8,500 rupees, red and green, 4 in stock.")).toMatchObject({ name: "Kanjivaram silk saree", price: "8500", colours: ["red", "green"], count: "4", stock: "in_stock" });
    expect(understand("services", "Haircut, 30 minutes, 200 rupees, book any day.")).toMatchObject({ name: "Haircut", minutes: "30", price: "200", booking: "any_day" });
    expect(understand("services", "Bridal makeup takes 3 hours, from 6,000 rupees, book ahead, at home")).toMatchObject({ name: "Bridal makeup", minutes: "180", price: "6000", priceFrom: true, booking: "book_ahead", place: "at_home" });
    expect(understand("courses", "NEET crash course, Mon to Fri 6 pm, 24,000 rupees, 30 seats.")).toMatchObject({ name: "NEET crash course", batch: "Mon to Fri 6 pm", fee: "24000", seats: "30" });
    expect(understand("properties", "2 BHK flat in Kukatpally, 1,150 sq ft, 68 lakh, available.")).toMatchObject({ name: "2 BHK flat", location: "Kukatpally", size: "1150", sizeUnit: "sq_ft", price: "68 lakh", status: "available" });
    expect(understand("pricelist", "Cotton shirting 40s, minimum 50 metres, 118 rupees.")).toMatchObject({ name: "Cotton shirting 40s", moq: "50", unit: "metre", rates: [{ fromQty: "50", rate: "118" }] });
  });
  it("what it does not find stays empty (the sheet asks), and a whole sentence of the mock builds a saveable entry", () => {
    expect(understand("products", "just a name")).toMatchObject({ name: "just a name", price: "", colours: [], count: "" });
    const f = understand("products", "Kanjivaram silk saree, 8,500 rupees, red and green, 4 in stock.");
    const e = buildEntry("products", "x", f, null, true);
    expect(e.ok && e.entry).toMatchObject({ name: "Kanjivaram silk saree", pricePaise: 850_000, stock: { state: "in_stock", count: 4 } });
    expect(understand("properties", "Plot in Shamshabad, 200 sq yd, 1.2 crore, booked")).toMatchObject({ sizeUnit: "sq_yd", price: "1.2 crore", status: "booked" });
  });
  it("it never changes the empty forms it starts from", () => {
    understand("products", "Silk saree, 100 rupees, red");
    expect(EMPTY.products.name).toBe("");
    expect((EMPTY as { pricelist: SellForm["pricelist"] }).pricelist.rates).toEqual([{ fromQty: "", rate: "" }]);
  });
});
