import { describe, expect, it } from "vitest";

import { parseRupees, rupees } from "@/lib/lists/types";

import { ApiRequestError } from "./client";
import { parseList, parseLists, parseRows, refusalOf } from "./lists";

const LIST = { id: "11111111-1111-4111-8111-111111111111", name: "Dress materials", kind: "products", is_main: false, row_count: 24, columns: [
  { key: "name", label: "Name", type: "text", choices: [], role: null, billing_period: null, quote_default: false },
  { key: "retail", label: "Retail price", type: "rupees", choices: [], role: "price", billing_period: "one_time", quote_default: true },
  { key: "stock", label: "Availability", type: "choice", choices: ["In stock", "Out"], role: "availability" },
] };

describe("lists: C1's answers, checked", () => {
  it("reads a list with its columns, roles and billing periods", () => {
    const l = parseList(LIST);
    expect(l).toMatchObject({ name: "Dress materials", kind: "products", rowCount: 24, isMain: false });
    expect(l.columns[1]).toMatchObject({ key: "retail", type: "rupees", role: "price", billingPeriod: "one_time", quoteDefault: true });
    expect(l.columns[2]).toMatchObject({ role: "availability", choices: ["In stock", "Out"], billingPeriod: null, quoteDefault: false });
    expect(parseLists({ lists: [LIST] })).toHaveLength(1);
  });
  it("a kind, a type or a role outside the contract is refused (nothing is guessed)", () => {
    expect(() => parseList({ ...LIST, kind: "cars" })).toThrow();
    expect(() => parseList({ ...LIST, columns: [{ ...LIST.columns[0], type: "money" }] })).toThrow();
    expect(() => parseList({ ...LIST, columns: [{ ...LIST.columns[1], role: "discount" }] })).toThrow();
  });
  it("reads rows: cells keyed by column, a number or text or nothing, active unless said otherwise", () => {
    const page = parseRows({ items: [{ id: "r1", name: "Blue", cells: { retail: 145000, lining: "Cotton", note: null, bad: { x: 1 } } }], next_cursor: null });
    expect(page.items[0]).toMatchObject({ name: "Blue", active: true, cells: { retail: 145000, lining: "Cotton", note: null, bad: null } });
    expect(page.nextCursor).toBeNull();
  });
  it("a refusal is a closed word and the fields it names; anything else is 'unavailable'", () => {
    expect(refusalOf(new ApiRequestError(409, "list_limit", "x"))).toEqual({ ok: false, error: "list_limit" });
    expect(refusalOf(new ApiRequestError(409, "conflict", "x", "one_default_price", undefined, undefined, { fields: ["retail"] } as never))).toEqual({ ok: false, error: "one_default_price", fields: ["retail"] });
    expect(refusalOf(new ApiRequestError(403, "weird", "x"))).toEqual({ ok: false, error: "forbidden" });
    expect(refusalOf(new Error("boom"))).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("rupees in whole paise", () => {
  it("draws ₹1,450 and ₹12,34,567.50", () => {
    expect(rupees(145000)).toBe("₹1,450");
    expect(rupees(123456750)).toBe("₹12,34,567.50");
  });
  it("reads what a person types; under ₹1 or not a number is nothing", () => {
    expect(parseRupees("1,450")).toBe(145000);
    expect(parseRupees("₹1,450.5")).toBe(145050);
    expect(parseRupees("0.50")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
  });
});
