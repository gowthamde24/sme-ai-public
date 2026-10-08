import { describe, expect, it } from "vitest";

import {
  EMPTY_VALUES,
  FIELD_NAMES,
  FIELD_TEXT,
  OUT_OF_DATE,
  calendarDate,
  hundredths,
  percentToBps,
  policyFromForm,
  publishRefusal,
  publishedSentence,
  rupeesToPaise,
  wholeNumber,
  type PolicyValues,
} from "./quote-policy-logic";

// Every number in this file is a SYNTHETIC placeholder for a test, not a suggestion and not the family's policy.
const ID = "55555555-5555-4555-8555-555555555555";
const TODAY = "2026-10-08";
const GOOD: PolicyValues = {
  effective_from: "2026-10-20",
  validity_days: "7",
  new_advance: "50",
  repeat_advance: "25.5",
  new_net_days: "10",
  repeat_net_days: "45",
  credit_limit: "2500.50",
  seller_state: "XX",
  discount_ceiling: "0",
};
const MAX_PAISE = 1_000_000_000;

describe("percent to basis points is exact, by reading the text", () => {
  it.each([
    ["0", 0],
    ["100", 10_000],
    ["100.00", 10_000],
    ["0.01", 1],
    ["0.1", 10],
    ["12.5", 1250],
    ["12.50", 1250],
    ["50", 5000],
    ["0.07", 7], // 0.07 * 100 is 7.000000000000001 in floating point
    ["1.15", 115], // 1.15 * 100 is 114.99999999999999
    ["4.35", 435],
    ["8.2", 820],
    ["007", 700],
    [" 50 ", 5000],
    ["  12.5", 1250],
    ["12.5  ", 1250],
  ])("%j -> %j", (text, bps) => {
    expect(percentToBps(text)).toBe(bps);
    expect(Number.isSafeInteger(percentToBps(text))).toBe(true);
  });
  it.each([
    ["100.01"],
    ["101"],
    ["12.345"],
    ["12.500"],
    ["0.001"],
    ["1e3"],
    ["1E2"],
    ["٥٠"], // Arabic-Indic digits
    ["５０"], // full-width digits
    ["౫౦"], // Telugu digits
    ["-1"],
    ["-0"],
    ["+5"],
    [""],
    ["   "],
    ["."],
    ["5."],
    [".5"],
    ["1,5"],
    ["1 000"],
    ["5 0"],
    ["50%"],
    ["0x10"],
    ["NaN"],
    ["Infinity"],
    ["99999999999999999999"],
    ["0.5.5"],
    ["five"],
  ])("%j is refused", (text) => {
    expect(percentToBps(text)).toBeNull();
  });
  it("the edges: 0 and the maximum are accepted, one hundredth beyond the maximum is not", () => {
    expect([percentToBps("0"), percentToBps("100"), percentToBps("100.01")]).toEqual([0, 10_000, null]);
  });
});

describe("rupees to paise is exact, by reading the text", () => {
  it.each([
    ["0", 0],
    ["0.01", 1],
    ["12.5", 1250],
    ["2500.50", 250_050],
    ["250000", 25_000_000],
    ["10000000", MAX_PAISE],
    ["10000000.00", MAX_PAISE],
    [" 10000000 ", MAX_PAISE],
    ["1.15", 115],
  ])("%j -> %j", (text, paise) => {
    expect(rupeesToPaise(text, MAX_PAISE)).toBe(paise);
  });
  it.each([["10000000.01"], ["10000001"], ["12.345"], ["1e3"], ["٥٠"], ["-1"], [""], ["1,50,000"], ["₹5"], ["5 rupees"], ["999999999999999"]])("%j is refused", (text) => {
    expect(rupeesToPaise(text, MAX_PAISE)).toBeNull();
  });
  it("a text with more than 12 digits before the point is refused without ever becoming a number", () => {
    expect(hundredths("1234567890123")).toBeNull();
    expect(hundredths("123456789012")).toBe(12_345_678_901_200);
  });
});

describe("whole numbers: days", () => {
  it.each([
    ["7", 1, 365, 7],
    ["1", 1, 365, 1],
    ["365", 1, 365, 365],
    ["0", 0, 180, 0],
    ["180", 0, 180, 180],
    ["007", 1, 365, 7],
    [" 30 ", 0, 180, 30],
  ])("%j in %j-%j -> %j", (text, min, max, expected) => {
    expect(wholeNumber(text, min, max)).toBe(expected);
  });
  it.each([
    ["0", 1, 365],
    ["366", 1, 365],
    ["181", 0, 180],
    ["-1", 0, 180],
    ["7.0", 1, 365],
    ["7.5", 1, 365],
    ["1e2", 1, 365],
    ["٧", 1, 365],
    ["", 1, 365],
    [" ", 0, 180],
    ["1000", 0, 999],
    ["seven", 1, 365],
    ["+7", 1, 365],
  ])("%j in %j-%j is refused", (text, min, max) => {
    expect(wholeNumber(text, min, max)).toBeNull();
  });
});

describe("dates", () => {
  it("accepts a real date and refuses one that does not exist or is not in the form", () => {
    expect(calendarDate("2026-10-20")).toBe("2026-10-20");
    expect(calendarDate(" 2026-10-20 ")).toBe("2026-10-20");
    expect(calendarDate("2028-02-29")).toBe("2028-02-29");
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "26-10-08", "2026-10-8", "20-10-2026", "", "tomorrow", "2026/10/20", "٢٠٢٦-١٠-٢٠"])
      expect(calendarDate(bad), bad).toBeNull();
  });
});

describe("the policy as typed", () => {
  it("every field starts empty: nothing is a default of ours", () => {
    expect(Object.values(EMPTY_VALUES).every((v) => v === "")).toBe(true);
    expect(Object.keys(EMPTY_VALUES).sort()).toEqual([...FIELD_NAMES].sort());
  });
  it("turns good text into the exact typed body, and only the ten fields of the input", () => {
    const r = policyFromForm(GOOD, ID, TODAY);
    expect(r).toEqual({
      ok: true,
      input: { id: ID, effectiveFrom: "2026-10-20", discountCeilingBps: 0, validityDays: 7, newAdvanceBps: 5000, repeatAdvanceBps: 2550, newNetDays: 10, repeatNetDays: 45, repeatCreditLimitPaise: 250_050, sellerState: "XX" },
    });
    if (r.ok) expect(Object.keys(r.input).sort()).toEqual(["discountCeilingBps", "effectiveFrom", "id", "newAdvanceBps", "newNetDays", "repeatAdvanceBps", "repeatCreditLimitPaise", "repeatNetDays", "sellerState", "validityDays"]);
  });
  it("the edges together: zero advances, zero credit, the longest validity, the biggest credit and discount are all accepted", () => {
    const r = policyFromForm({ ...GOOD, validity_days: "365", new_advance: "0", repeat_advance: "100", new_net_days: "180", repeat_net_days: "0", credit_limit: "10000000", discount_ceiling: "100" }, ID, TODAY);
    expect(r.ok && r.input).toMatchObject({ validityDays: 365, newAdvanceBps: 0, repeatAdvanceBps: 10_000, newNetDays: 180, repeatNetDays: 0, repeatCreditLimitPaise: MAX_PAISE, discountCeilingBps: 10_000 });
  });
  it("trims spaces around every field", () => {
    const spaced = Object.fromEntries(Object.entries(GOOD).map(([k, v]) => [k, `  ${v}  `])) as PolicyValues;
    expect(policyFromForm(spaced, ID, TODAY)).toEqual(policyFromForm(GOOD, ID, TODAY));
  });
  it("a start date of today is accepted; yesterday is not", () => {
    expect(policyFromForm({ ...GOOD, effective_from: TODAY }, ID, TODAY).ok).toBe(true);
    expect(policyFromForm({ ...GOOD, effective_from: "2026-10-07" }, ID, TODAY)).toEqual({ ok: false, error: FIELD_TEXT.effective_from });
  });
  it.each(FIELD_NAMES.map((name) => [name]))("a missing %s blocks the save with that field's sentence", (name) => {
    expect(policyFromForm({ ...GOOD, [name]: "" }, ID, TODAY)).toEqual({ ok: false, error: FIELD_TEXT[name] });
  });
  it.each([
    ["effective_from", "2026-02-30"],
    ["validity_days", "0"],
    ["validity_days", "366"],
    ["validity_days", "1e1"],
    ["new_advance", "100.01"],
    ["new_advance", "12.345"],
    ["new_advance", "-1"],
    ["repeat_advance", "٥٠"],
    ["repeat_advance", "101"],
    ["new_net_days", "181"],
    ["new_net_days", "-1"],
    ["repeat_net_days", "181"],
    ["repeat_net_days", "-1"],
    ["repeat_net_days", "1.5"],
    ["credit_limit", "10000000.01"],
    ["credit_limit", "1,000"],
    ["credit_limit", "0.001"],
    ["seller_state", "x"],
    ["seller_state", "xx"],
    ["seller_state", "XXX"],
    ["seller_state", "X1"],
    ["seller_state", "ÀB"],
    ["discount_ceiling", "100.01"],
    ["discount_ceiling", "1e3"],
    ["discount_ceiling", "-0.01"],
  ] as const)("%s = %j blocks the save with that field's sentence", (name, value) => {
    expect(policyFromForm({ ...GOOD, [name]: value }, ID, TODAY)).toEqual({ ok: false, error: FIELD_TEXT[name] });
  });
  it("when several fields are wrong the first one in the form's order is named", () => {
    expect(policyFromForm({ ...GOOD, new_net_days: "x", validity_days: "x" }, ID, TODAY)).toEqual({ ok: false, error: FIELD_TEXT.validity_days });
  });
  it("an id that is not a canonical UUID is out of date", () => {
    expect(policyFromForm(GOOD, "x", TODAY)).toEqual({ ok: false, error: OUT_OF_DATE });
    expect(policyFromForm(GOOD, "", TODAY)).toEqual({ ok: false, error: OUT_OF_DATE });
  });
  it("no sentence repeats what was typed", () => {
    const r = policyFromForm({ ...GOOD, new_advance: "SECRET-TYPED-77" }, ID, TODAY);
    expect(r.ok === false && r.error).not.toContain("SECRET");
  });
  it("the sentences name no GST rate, no price range and no last-price threshold", () => {
    expect(Object.values(FIELD_TEXT).join(" ")).not.toMatch(/GST rate|price range|last price/i);
  });
});

describe("one sentence of our own for each closed code", () => {
  const CANARY = "CANARY-9f3b2c";
  const cases: [number, string][] = [
    [403, "forbidden"],
    [403, "mfa_required"],
    [422, "validation_error"],
    [422, "invalid_value"],
    [409, "conflict"],
    [404, "not_found"],
    [429, "rate_limited"],
    [429, "anything"],
    [401, "token_expiring"],
    [503, "quotes_unavailable"],
    [503, "api_unreachable"],
    [502, "upstream_error"],
    [500, "weird_code"],
    [418, "http_error"],
  ];
  it.each(cases)("%i %s gives a sentence of ours, with no API text", (status, code) => {
    const r = publishRefusal(status, code);
    expect(r.error.length).toBeGreaterThan(10);
    expect(r.error).not.toContain(CANARY);
    expect(r.error).not.toContain(code);
  });
  it("each closed code has its own wording", () => {
    const words = (s: number, c: string) => publishRefusal(s, c).error;
    const distinct = new Set([
      words(403, "forbidden"),
      words(403, "mfa_required"),
      words(422, "validation_error"),
      words(422, "invalid_value"),
      words(409, "conflict"),
      words(429, "x"),
      words(503, "x"),
      words(500, "x"),
    ]);
    expect(distinct.size).toBe(8);
  });
  it("only a missing second factor asks for the link to the second-factor page", () => {
    expect(publishRefusal(403, "mfa_required").reason).toBe("mfa");
    for (const [status, code] of cases.filter(([, c]) => c !== "mfa_required")) expect(publishRefusal(status, code).reason, code).toBeUndefined();
  });
  it("the status decides when the code is not one we know", () => {
    expect(publishRefusal(429, "other").error).toMatch(/Too many requests/);
    expect(publishRefusal(503, "other").error).toMatch(/not available right now/);
    expect(publishRefusal(404, "other").error).toMatch(/workspace is not available/);
  });
  it("the retryable refusals say that pressing the button again publishes nothing twice", () => {
    for (const [status, code] of [[429, "x"], [503, "x"], [500, "x"]] as const) expect(publishRefusal(status, code).error).toMatch(/Nothing is published twice/);
  });
});

describe("the success sentence", () => {
  const fmt = (iso: string) => `D(${iso})`;
  it("says the version number and the start date", () => {
    expect(publishedSentence(3, "2026-10-20", false, fmt)).toBe("Published version 3, starting on D(2026-10-20).");
  });
  it("a replay says so and that nothing was published twice", () => {
    expect(publishedSentence(3, "2026-10-20", true, fmt)).toBe("Version 3 was already published, starting on D(2026-10-20). Nothing was published twice.");
  });
});
