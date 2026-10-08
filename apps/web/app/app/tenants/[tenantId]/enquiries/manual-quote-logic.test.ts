import { describe, expect, it } from "vitest";

import { parseItemTypes } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON } from "@/lib/api/quotes-fixtures";

import { EMPTY_LINE, LINE_TEXT, MAX_LINES, NEED_A_LINE, RANGE_NOTE, TOO_MANY_LINES, linesFromForm, priceToPaise, quantityOf, showRangeNote, type LineValues } from "./manual-quote-logic";

const types = parseItemTypes([TYPE_A_JSON, TYPE_B_JSON]);
const line = (over: Partial<LineValues> = {}): LineValues => ({ code: "A", qty: "3", price: "2500", ...over });

describe("rupees to integer paise, by reading the text (no floating point)", () => {
  it.each([
    ["1", 100], ["0.01", 1], ["0.1", 10], ["0.10", 10], ["1.5", 150], ["1.50", 150], ["2500", 250_000], ["2499.99", 249_999], ["999.99", 99_999], ["10", 1000],
    ["10,00,000", null], ["1000000", 100_000_000], ["1000000.00", 100_000_000], ["  7  ", 700], ["007", 700], ["0.3", 30], ["1.15", 115], ["1.005", null],
  ])("%j -> %j", (text, paise) => {
    expect(priceToPaise(text)).toBe(paise);
  });
  it("the sums that go wrong in floating point are exact here", () => {
    expect(priceToPaise("0.1")! + priceToPaise("0.2")!).toBe(priceToPaise("0.3"));
    expect(priceToPaise("1.15")).toBe(115); // 1.15 * 100 is 114.99999999999999 in floating point
    expect(priceToPaise("4.35")).toBe(435); // 4.35 * 100 is 434.99999999999994
    expect(priceToPaise("8.2")).toBe(820);
  });
  it.each(["", " ", "0", "0.00", "0.0", "-1", "-0.01", "+1", "1.505", "1.5050", "1.", ".5", "abc", "1e3", "1E3", "1,000", "1 000", "₹100", "100₹", "१००", "1.2.3", "NaN", "Infinity", "1000000.01", "1000001", "99999999999999999"])(
    "%j is refused",
    (text) => {
      expect(priceToPaise(text)).toBeNull();
    },
  );
  it("the largest price is exactly the API's limit and one paisa more is refused", () => {
    expect(priceToPaise("1000000.00")).toBe(100_000_000);
    expect(priceToPaise("1000000.01")).toBeNull();
  });
});

describe("quantities", () => {
  it.each([["1", 1], ["3", 3], ["10000", 10_000], [" 12 ", 12], ["00012", 12]])("%j -> %j", (text, n) => expect(quantityOf(text)).toBe(n));
  it.each(["", "0", "10001", "-1", "1.5", "1e3", "abc", "1,000", "100000", "१"])("%j is refused", (text) => expect(quantityOf(text)).toBeNull());
});

describe("the lines as the request wants them", () => {
  it("turns good text into the exact lines (rupees to paise, nothing else added)", () => {
    expect(linesFromForm([line(), line({ code: "B", qty: "1", price: "999.99" })])).toEqual({
      ok: true,
      lines: [
        { itemTypeCode: "A", qty: 3, unitPricePaise: 250_000 },
        { itemTypeCode: "B", qty: 1, unitPricePaise: 99_999 },
      ],
    });
  });
  it("accepts one to five lines and no other number", () => {
    expect(linesFromForm([line()]).ok).toBe(true);
    expect(linesFromForm(Array(MAX_LINES).fill(line())).ok).toBe(true);
    expect(linesFromForm([])).toEqual({ ok: false, error: NEED_A_LINE });
    expect(linesFromForm(Array(MAX_LINES + 1).fill(line()))).toEqual({ ok: false, error: TOO_MANY_LINES });
  });
  it("names the first problem, with its line number, and repeats nothing the person typed", () => {
    expect(linesFromForm([line({ code: "" })])).toEqual({ ok: false, error: `Line 1: ${LINE_TEXT.itemType}`, line: 1 });
    expect(linesFromForm([line(), line({ qty: "0" })])).toEqual({ ok: false, error: `Line 2: ${LINE_TEXT.qty}`, line: 2 });
    const typed = "9.999CANARY";
    const r = linesFromForm([line({ price: typed })]);
    expect(r).toEqual({ ok: false, error: `Line 1: ${LINE_TEXT.price}`, line: 1 });
    expect(JSON.stringify(r)).not.toContain("CANARY");
  });
  it("an item type code that is not a plain short code is refused before anything is sent", () => {
    for (const code of ["a b", "-x", "x".repeat(21), "a/b", "../x"]) expect(linesFromForm([line({ code })]).ok).toBe(false);
  });
  it("an empty line is refused", () => {
    expect(linesFromForm([{ ...EMPTY_LINE }]).ok).toBe(false);
  });
});

describe("the neutral range note", () => {
  it("shows for a price outside the item type's range, on either side", () => {
    expect(showRangeNote(line({ code: "B", price: "499.99" }), types)).toBe(true); // Type B is usually 500.00 to 4,000.00
    expect(showRangeNote(line({ code: "B", price: "4000.01" }), types)).toBe(true);
  });
  it("does not show on the bounds or inside", () => {
    for (const price of ["500", "500.00", "2000", "4000", "4000.00"]) expect(showRangeNote(line({ code: "B", price }), types), price).toBe(false);
  });
  it("never shows for an item type without a range, an unknown type, or a price that does not parse", () => {
    expect(showRangeNote(line({ code: "A", price: "99999" }), types)).toBe(false);
    expect(showRangeNote(line({ code: "ZZ", price: "1" }), types)).toBe(false);
    expect(showRangeNote(line({ code: "", price: "1" }), types)).toBe(false);
    for (const price of ["", "abc", "0", "1.505", "-5"]) expect(showRangeNote(line({ code: "B", price }), types), price).toBe(false);
  });
  it("is the sentence the owner approved", () => {
    expect(RANGE_NOTE).toBe("This price is outside the usual range for this item type. You can still save it; the owner will see a flag.");
  });
});
