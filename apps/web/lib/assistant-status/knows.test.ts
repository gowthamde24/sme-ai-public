import { describe, expect, it } from "vitest";

import { parseKnows } from "./knows";

describe("phone-knows: C1's answer, checked", () => {
  it("reads the counts, what is missing in the API's order, and ready", () => {
    expect(parseKnows({ price_rows: 4, catalogue_items: 30, faq_answers: 2, notes_lines: 1, has_hours: true, missing: ["price_list", "answers"], ready: false, message: "Add your prices" })).toEqual({ priceRows: 4, catalogueItems: 30, faqAnswers: 2, notesLines: 1, hasHours: true, missing: ["price_list", "answers"], ready: false });
  });
  it("a count that is not a whole number is 0; a word it does not know, or a missing field, is no line at all", () => {
    expect(parseKnows({ price_rows: -1, catalogue_items: "3", faq_answers: 1.5, missing: [], ready: true })).toMatchObject({ priceRows: 0, catalogueItems: 0, faqAnswers: 0, ready: true });
    expect(parseKnows({ missing: ["tax"], ready: false })).toBeNull();
    expect(parseKnows({ missing: [] })).toBeNull();
    expect(parseKnows(null)).toBeNull();
  });
});
