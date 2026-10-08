import { describe, expect, it } from "vitest";

import { parseItemTypes } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";

import { CODE_SENTENCE, RANGE_SENTENCE, TEXT, inListOrder, itemTypeFromForm, paiseToRupeesText, saveRefusal, type ItemTypeValues } from "./item-types-logic";

const good = (over: Partial<ItemTypeValues> = {}): ItemTypeValues => ({ name: "Type A", code: "A", position: "1", active: true, lowest: "", highest: "", ...over });

describe("the item type as the request wants it", () => {
  it("turns good text into the exact input (rupees into integer paise, nothing else added)", () => {
    expect(itemTypeFromForm(good({ lowest: "500", highest: "4000.50" }), "A")).toEqual({
      ok: true,
      input: { code: "A", name: "Type A", position: 1, active: true, minPricePaise: 50_000, maxPricePaise: 400_050 },
    });
  });
  it("an empty price is no bound at all, either side", () => {
    expect(itemTypeFromForm(good({ lowest: "  " }), "A")).toMatchObject({ ok: true, input: { minPricePaise: null, maxPricePaise: null } });
    expect(itemTypeFromForm(good({ highest: "10" }), "A")).toMatchObject({ ok: true, input: { minPricePaise: null, maxPricePaise: 1000 } });
  });
  it("the same two bounds are allowed", () => {
    expect(itemTypeFromForm(good({ lowest: "250", highest: "250" }), "A").ok).toBe(true);
  });
  it("the lowest price above the highest is refused with its own sentence", () => {
    expect(itemTypeFromForm(good({ lowest: "500.01", highest: "500" }), "A")).toEqual({ ok: false, error: TEXT.order });
  });
  it.each(["0", "0.00", "-1", "1.505", "abc", "1e3", "1,000", "10,00,000", "1000000.01", "₹5"])("a price of %j is refused (no floating point, no guessing)", (price) => {
    expect(itemTypeFromForm(good({ lowest: price }), "A")).toEqual({ ok: false, error: TEXT.lowest });
    expect(itemTypeFromForm(good({ highest: price }), "A")).toEqual({ ok: false, error: TEXT.highest });
  });
  it("the biggest price is the API's limit", () => {
    expect(itemTypeFromForm(good({ highest: "1000000" }), "A")).toMatchObject({ ok: true, input: { maxPricePaise: 100_000_000 } });
  });
  it.each(["", "   ", "x".repeat(201)])("a name of %j is refused", (name) => expect(itemTypeFromForm(good({ name }), "A")).toEqual({ ok: false, error: TEXT.name }));
  it("a name of 200 characters is accepted and trimmed", () => {
    expect(itemTypeFromForm(good({ name: `  ${"x".repeat(200)}  ` }), "A").ok).toBe(true);
  });
  it.each(["", "a b", "-x", "_x", "x".repeat(21), "a/b", "../x", "é"])("a code of %j is refused", (code) => {
    expect(itemTypeFromForm(good(), code)).toEqual({ ok: false, error: TEXT.code });
  });
  it.each(["01", "A1", "a_b-c", "x".repeat(20)])("a code of %j is accepted", (code) => expect(itemTypeFromForm(good(), code).ok).toBe(true));
  it.each(["", "-1", "1.5", "abc", "10001", "100000", "1e2"])("an order of %j is refused", (position) => {
    expect(itemTypeFromForm(good({ position }), "A")).toEqual({ ok: false, error: TEXT.position });
  });
  it.each([["0", 0], ["10000", 10_000], [" 7 ", 7]])("an order of %j is accepted as %i", (position, n) => {
    expect(itemTypeFromForm(good({ position }), "A")).toMatchObject({ ok: true, input: { position: n } });
  });
  it("the active tick box is the person's choice", () => {
    expect(itemTypeFromForm(good({ active: false }), "A")).toMatchObject({ ok: true, input: { active: false } });
  });
  it("no sentence repeats what was typed", () => {
    const r = itemTypeFromForm(good({ lowest: "CANARY-77" }), "A");
    expect(JSON.stringify(r)).not.toContain("CANARY");
  });
});

describe("rupees back into text for the edit form", () => {
  it.each([[null, ""], [50_000, "500"], [99_999, "999.99"], [100, "1"], [5, "0.05"], [10, "0.1"], [100_000_000, "1000000"], [250, "2.5"]])("%j -> %j", (paise, text) => {
    expect(paiseToRupeesText(paise)).toBe(text);
  });
  it("and reads back to the same paise (a round trip loses nothing)", () => {
    for (const paise of [1, 5, 10, 99, 100, 101, 250, 99_999, 400_050, 100_000_000]) {
      const r = itemTypeFromForm(good({ lowest: paiseToRupeesText(paise) }), "A");
      expect(r).toMatchObject({ ok: true, input: { minPricePaise: paise } });
    }
  });
});

describe("order and sentences", () => {
  it("the list is in the owner's order and then by code", () => {
    const more = { ...TYPE_A_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9", code: "A0", name: "Type A0", position: 1 };
    const list = parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, more, TYPE_A_JSON]);
    expect(inListOrder(list).map((t) => t.code)).toEqual(["C", "A", "A0", "B"]);
  });
  it("says in one plain sentence that a price outside the range only warns and never blocks", () => {
    expect(RANGE_SENTENCE).toBe("A price outside the lowest and highest price only gives a warning when a quote is made. It never stops a quote.");
  });
  it("says plainly that a code is typed once, never changed, and a type is never deleted", () => {
    expect(CODE_SENTENCE).toBe("The code is typed once and can never be changed. An item type can never be deleted, only switched off.");
  });
  it("the words are plain: no second-factor, SKU or basis-point jargon on the page text", () => {
    const all = [...Object.values(TEXT), RANGE_SENTENCE, CODE_SENTENCE].join(" ");
    expect(all).not.toMatch(/aal2|SKU|basis point|bps|paise|JSON|API/i);
  });
});

describe("refusals", () => {
  const cases: [number, string, RegExp, boolean][] = [
    [403, "mfa_required", /authenticator app/, true],
    [403, "forbidden", /Only an owner or an admin/, false],
    [422, "validation_error", /not accepted/, false],
    [422, "invalid_value", /lowest price is above the highest/, false],
    [404, "not_found", /not available/, false],
    [429, "rate_limited", /Too many requests/, false],
    [401, "token_expiring", /session is about to expire/, false],
    [503, "quotes_unavailable", /not available right now/, false],
    [502, "upstream_error", /not available right now/, false],
    [500, "anything", /Could not save/, false],
  ];
  it.each(cases)("%i %s", (status, code, pattern, mfa) => {
    const r = saveRefusal(status, code);
    expect(r.error).toMatch(pattern);
    expect(r.reason === "mfa").toBe(mfa);
  });
});
