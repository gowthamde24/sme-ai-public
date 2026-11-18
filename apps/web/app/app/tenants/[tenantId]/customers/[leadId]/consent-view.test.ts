import { describe, expect, it } from "vitest";

import { consentView } from "./customer-logic";

const w = { "cust.v4.consent.granted": "Said yes to offers", "cust.v4.consent.unknown": "Not asked about offers", "cust.v4.consent.how": "How: {how}", "cust.v4.consent.nohow": "No note on how", "cust.v4.consent.label": "Offers: tap" };

describe("the consent chip's words", () => {
  it("joins the day, who recorded it and the note", () => {
    const v = consentView({ state: "granted", at: "2026-11-12T10:00:00Z", by: "Ravi", note: "told us in the shop" }, w, () => "12 Nov");
    expect(v).toEqual({ state: "granted", label: "Said yes to offers", how: "How: 12 Nov · Ravi · told us in the shop", hint: "Offers: tap" });
  });
  it("a customer never asked has no how", () => {
    const v = consentView({ state: "unknown", at: null, by: null, note: null }, w, () => "x");
    expect(v.label).toBe("Not asked about offers");
    expect(v.how).toBe("No note on how");
  });
});
