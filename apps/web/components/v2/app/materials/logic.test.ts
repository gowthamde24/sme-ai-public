import { describe, expect, it } from "vitest";

import { parseCalc, parseItem, parseQuoteDetail } from "@/lib/api/materials";
import { CALC_JSON, ITEM_BARE_JSON, ITEM_JSON, QUOTE_DETAIL_JSON, REJECTED_CALC_JSON } from "@/lib/api/materials-fixtures";

import { figuresFromCalc, figuresFromQuote } from "./figures";
import { badgesOf, missingFor, quotable } from "./mat-logic";
import { traceSentence } from "./trace-text";
import { WORDS } from "./mat-test-kit";

describe("what a product still needs", () => {
  it("a product with every figure can be quoted; one with none says what is missing, once each, in a fixed vocabulary", () => {
    expect(quotable(parseItem(ITEM_JSON))).toBe(true);
    const bare = parseItem({ ...ITEM_BARE_JSON, inputs: { ...ITEM_BARE_JSON.inputs, missing_for_quantity: ["price", "gst_rate", "price", "something_new"] } });
    expect(quotable(bare)).toBe(false);
    expect(missingFor(bare.inputs, false)).toEqual(["price", "gst_rate", "other"]);
  });
  it("by area it needs the area figures too", () => {
    const byArea = parseItem({ ...ITEM_JSON, inputs: { ...ITEM_JSON.inputs, missing_for_area: ["pieces_per_area", "area_unit"] } });
    expect(quotable(byArea)).toBe(false);
    expect(missingFor(byArea.inputs, true)).toEqual(["pieces_per_area", "area_unit"]);
  });
  it("badges: hidden, few left, made to order", () => {
    expect(badgesOf({ active: false, stock_status: "made_to_order" })).toEqual(["inactive", "made_to_order"]);
    expect(badgesOf({ active: true, stock_status: "in_stock" })).toEqual([]);
  });
});

describe("the figures of a quote", () => {
  it("a preview and a stored quote give the same figures", () => {
    const a = figuresFromCalc(parseCalc(CALC_JSON), [{ areaX100: 100000, areaUnit: "sq_ft" }]);
    const b = figuresFromQuote(parseQuoteDetail(QUOTE_DETAIL_JSON));
    expect(a).not.toBeNull();
    expect(a!.totalPaise).toBe(b.totalPaise);
    expect(a!.lines[0]).toMatchObject({ pieces: 4725, pallets: 10, materialPaise: 6825000, taxPaise: 1228500, areaX100: 100000 });
    expect(a!.advancePaise + a!.balancePaise).toBe(a!.totalPaise);
    expect(a!.rangeLowPaise).toBe(8496000);
    expect(b.rangeLowPaise).toBeNull();
  });
  it("a rejected calculation has no figures", () => {
    expect(figuresFromCalc(parseCalc(REJECTED_CALC_JSON))).toBeNull();
  });
  it("the totals add up the way the engine said", () => {
    const f = figuresFromQuote(parseQuoteDetail(QUOTE_DETAIL_JSON));
    expect(f.materialPaise + f.transportPaise + f.handlingPaise + f.layingPaise + f.taxPaise).toBe(f.totalPaise);
  });
});

describe("the working in words", () => {
  const sentence = (rule_id: string, inputs: Record<string, unknown>) => traceSentence({ rule_id, inputs }, WORDS);
  it("puts the engine's numbers into a sentence", () => {
    expect(sentence("quantity.area", { area_x100: 100000, pieces_without_wastage: 4500, wastage_bps: 500, pieces: 4725, pallets: 10 })).toBe("1,000 needs 4,500 pieces; with 5 percent wastage that is 4,725 pieces (10 pallets).");
    expect(sentence("transport.per_trip", { trips: 2, rate_per_trip_paise: 350000, transport: 700000 })).toBe("2 trips at ₹3,500.00 = ₹7,000.00.");
    expect(sentence("trips", { load: 4725, capacity: 2500, trips: 2 })).toBe("Load 4,725; a truck carries 2,500; so 2 trips.");
    expect(sentence("quote.validity", { valid_until: "2026-10-21" })).toBe("Valid until 2026-10-21.");
  });
  it("a step this code does not know is shown by its name, never hidden", () => {
    expect(sentence("brand.new.rule", {})).toBe("Step: brand.new.rule");
  });
  it("a number that is missing is zero, never NaN or undefined", () => {
    expect(sentence("tax.item", {})).toBe("GST 0 percent on the material = ₹0.00.");
  });
});
