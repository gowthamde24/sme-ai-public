import { describe, expect, it } from "vitest";

import { applyFilter, filterHref, mockLeads, NO_FILTER, parseFilter } from "./leads";
import { parseProfile } from "./profile";

const FULL = { name: "Ravi", phone_e164: "+919876543210", need: "Paver blocks", quantity: "2000 sq ft", area: "Gandhi Nagar", city: "Anantapur", budget: "Rs 60,000", timeline: "This month", urgency: "high", campaign: "Diwali", original_text: "need pavers 2000 sqft", confidence: { need: "high", quantity: "low", urgency: "medium", phone_e164: "low", city: "high" }, duplicate_of: null, merged_count: 2, junk: false, fixed_by_you: ["urgency"] };

describe("the lead's profile", () => {
  it("reads what the lead is; only guessed fields are marked, and what the person fixed is not", () => {
    const p = parseProfile(FULL);
    expect(p).toMatchObject({ need: "Paver blocks", quantity: "2000 sq ft", area: "Gandhi Nagar", urgency: "high", originalText: "need pavers 2000 sqft", mergedCount: 2, junk: null });
    expect(p?.guessed.sort()).toEqual(["phone", "quantity"]); // urgency was fixed by the person
  });
  it("a junk lead says why; an unknown reason, urgency or a missing profile is simply nothing", () => {
    expect(parseProfile({ junk: { reason: "spam" } })?.junk).toBe("spam");
    expect(parseProfile({ junk: { reason: "weird" }, urgency: "asap" })).toMatchObject({ junk: null, urgency: null });
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile("x")).toBeNull();
  });
});

describe("the list's filters", () => {
  const now = new Date("2026-10-28T10:00:00Z");
  const leads = mockLeads(now, {}, [], "u1");
  it("junk stays out of the list until asked for (it is flagged, never deleted)", () => {
    const junk = leads.find((l) => l.profile?.junk);
    expect(junk).toBeTruthy();
    expect(applyFilter(leads, NO_FILTER, "u1").some((l) => l.id === junk?.id)).toBe(false);
    expect(applyFilter(leads, { ...NO_FILTER, junk: true }, "u1").some((l) => l.id === junk?.id)).toBe(true);
  });
  it("filters by urgency and by the words in the name, need, place and what they wrote", () => {
    expect(applyFilter(leads, { ...NO_FILTER, urgency: "high" }, "u1").every((l) => l.profile?.urgency === "high")).toBe(true);
    expect(applyFilter(leads, { ...NO_FILTER, q: "paver" }, "u1").map((l) => l.profile?.need)).toEqual(["Paver blocks"]);
    expect(applyFilter(leads, { ...NO_FILTER, q: "KALYANDURG" }, "u1")).toHaveLength(1);
  });
  it("reads the new parts of the address and writes them back; anything unknown is no filter", () => {
    expect(parseFilter({ urgency: "high", junk: "1", q: "  tiles " })).toMatchObject({ urgency: "high", junk: true, q: "tiles" });
    expect(parseFilter({ urgency: "now", q: ["a", "b"] })).toMatchObject({ urgency: null, q: "a" });
    expect(filterHref("/b", { ...NO_FILTER, urgency: "low", junk: true, q: "x" })).toBe("/b/lead-desk?urgency=low&junk=1&q=x");
  });
});
