import { describe, expect, it } from "vitest";

import type { NeedsCard } from "../types";
import { CHIPS, PLACEHOLDER_KEYS, deriveSuggestions, estimateJob, headlineKey, linePieces, maskNumber, quotesPaiseOf } from "./band-data";

const item = (kind: string, over: Record<string, unknown> = {}, count?: number): NeedsCard =>
  ({ type: "item", key: `${kind}-${Math.random()}`, at: "2026-11-13T05:00:00Z", item: { kind, id: "x", customer: "A", city: null, agent: "followup_desk", summary: "s", at: "2026-11-13T05:00:00Z", amount_paise: null, target: { type: "lead", id: "y" }, href: "/x", ...(count ? { count } : {}), ...over } }) as unknown as NeedsCard;

describe("the estimate (a mock with the shape of POST /billing/estimate)", () => {
  it("calls x minutes at the plan's rate, in ₹ and in words", () => {
    expect(estimateJob({ calls: 14, avgMinutes: 2 })).toEqual({ costText: "about ₹126", timeText: "about 28 min", totalMinutes: 28 });
    expect(estimateJob({ calls: 40, avgMinutes: 4 })).toMatchObject({ timeText: "about 2 h 40 min", costText: "about ₹720" });
    expect(estimateJob({ calls: 30, avgMinutes: 2 }).timeText).toBe("about 1 h");
  });
  it("never says 0 minutes", () => {
    expect(estimateJob({ calls: 0, avgMinutes: 2 }).timeText).toBe("about 1 min");
  });
});

describe("the one line under the greeting", () => {
  it("says enquiries, visits and ₹ in quotes, and leaves out a piece it cannot read", () => {
    expect(linePieces({ enquiries: 4, visits: 2, quotesPaise: 4_800_000 })).toEqual([
      { key: "enq", n: 4 },
      { key: "visits", n: 2 },
      { key: "quotes", n: 1, amount: "₹48,000" },
    ]);
    expect(linePieces({ enquiries: null, visits: 0, quotesPaise: null })).toEqual([{ key: "visits", n: 0 }]);
    expect(linePieces({ enquiries: null, visits: null, quotesPaise: 0 })).toEqual([]);
  });
  it("adds up only the amounts the quote cards carry", () => {
    expect(quotesPaiseOf(null)).toBeNull();
    expect(quotesPaiseOf([item("quote_approval")])).toBeNull();
    expect(quotesPaiseOf([item("quote_approval", { amount_paise: 100_000 }), item("material_quote_approval", { amount_paise: 50_000 }), item("followup_due", { amount_paise: 999 })])).toBe(150_000);
  });
});

describe("the suggested jobs", () => {
  it("come from the business's own data: follow-ups due, new enquiries, quotes waiting; at most three", () => {
    const s = deriveSuggestions({ needs: [item("followup_due"), item("callback_due", {}, 3), item("quote_approval", { amount_paise: 250_000 })], newLeads: 5 });
    expect(s.map((x) => x.id)).toEqual(["followups", "leads", "quotes"]);
    expect(s[0]).toMatchObject({ n: 4, est: { totalMinutes: 8 } });
    expect(s[1]).toMatchObject({ n: 5, est: { totalMinutes: 10 } });
    expect(s[2]).toMatchObject({ n: 1, est: null, amountPaise: 250_000 });
  });
  it("offers nothing when there is nothing: the row is not drawn", () => {
    expect(deriveSuggestions({ needs: [], newLeads: 0 })).toEqual([]);
    expect(deriveSuggestions({ needs: null, newLeads: null })).toEqual([]);
  });
  it("caps one calling job at 20 calls (the plan card still asks for the OK)", () => {
    expect(deriveSuggestions({ needs: [], newLeads: 100 })[0]).toMatchObject({ n: 100, est: { totalMinutes: 40 } });
  });
});

describe("the number is never shown in full", () => {
  it("keeps the country code and the last three digits", () => {
    expect(maskNumber("+91 98765 43421")).toBe("+91 ••••• ••421");
    expect(maskNumber("9876543421")).toBe("+91 ••••• ••421");
    expect(maskNumber("+1 415 555 0132")).toBe("+1 ••••• ••132");
  });
  it("gives nothing for what is not a number", () => {
    expect(maskNumber(null)).toBeNull();
    expect(maskNumber("12")).toBeNull();
    expect(maskNumber("abc")).toBeNull();
    expect(maskNumber("1".repeat(20))).toBeNull();
  });
  it("never contains the middle digits", () => {
    expect(maskNumber("+91 98765 43421")).not.toMatch(/9876|5434/);
  });
});

describe("the phone's headline and the bar's examples", () => {
  it("counts the things that need the person; unknown = no headline", () => {
    expect(headlineKey(null)).toBeNull();
    expect(headlineKey(0)?.key).toBe("tv6.head.none");
    expect(headlineKey(1)?.key).toBe("tv6.head.one");
    expect(headlineKey(6)).toEqual({ key: "tv6.head.other", n: 6 });
  });
  it("has four examples and four chips (Call people, WhatsApp, Quote, Find customers)", () => {
    expect(PLACEHOLDER_KEYS).toHaveLength(4);
    expect(CHIPS.map((c) => c.id)).toEqual(["call", "whatsapp", "quote", "find"]);
  });
});
