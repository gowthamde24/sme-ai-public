import { describe, expect, it } from "vitest";

import type { NeedsCard } from "../types";
import { CHIPS, PLACEHOLDER_KEYS, ghostOf, linePieces, topDecision } from "./band-data";

const item = (kind: string, over: Record<string, unknown> = {}): NeedsCard =>
  ({ type: "item", key: `${kind}-${Math.random()}`, at: "2026-11-13T05:00:00Z", item: { kind, id: "x", customer: "Kavya", city: null, agent: "quote_writer", summary: "s", at: "2026-11-13T05:00:00Z", amount_paise: null, target: { type: "quote", id: "y" }, href: "/app/tenants/T/enquiries/E", ...over } }) as unknown as NeedsCard;

describe("the briefing's first sentence", () => {
  it("says enquiries and visits booked, and leaves out a piece it cannot read", () => {
    expect(linePieces({ enquiries: 14, visits: 4 })).toEqual([{ key: "enq", n: 14 }, { key: "visits", n: 4 }]);
    expect(linePieces({ enquiries: null, visits: 0 })).toEqual([{ key: "visits", n: 0 }]);
    expect(linePieces({ enquiries: null, visits: null })).toEqual([]);
  });
});

describe("the top decision (the link in the briefing)", () => {
  it("is the first quote with an amount that waits for the OK: the amount, the customer and where it opens", () => {
    expect(topDecision([item("followup_due"), item("quote_approval", { amount_paise: 2_450_000 }), item("quote_approval", { amount_paise: 100 })])).toEqual({ amountText: "₹24,500", name: "Kavya", href: "/app/tenants/T/enquiries/E" });
    expect(topDecision([item("material_quote_approval", { amount_paise: 50_000 })])?.amountText).toBe("₹500");
  });
  it("is nothing when no quote with an amount waits (never a guess)", () => {
    expect(topDecision(null)).toBeNull();
    expect(topDecision([])).toBeNull();
    expect(topDecision([item("quote_approval"), item("followup_due", { amount_paise: 999 })])).toBeNull();
  });
});

describe("the ghost completion", () => {
  const ex = ["Call everyone who asked about wedding sarees this week", "WhatsApp my new enquiries the Diwali offer"];
  it("is the rest of the first example that starts with what is typed, not case-sensitive", () => {
    expect(ghostOf("Call everyone who", ex)).toBe(" asked about wedding sarees this week");
    expect(ghostOf("whatsapp my", ex)).toBe(" new enquiries the Diwali offer");
  });
  it("offers nothing for one letter, for no match, or for a finished example", () => {
    expect(ghostOf("c", ex)).toBeNull();
    expect(ghostOf("", ex)).toBeNull();
    expect(ghostOf("Quote for Ravi", ex)).toBeNull();
    expect(ghostOf(ex[0], ex)).toBeNull();
  });
});

describe("the examples and the chips", () => {
  it("has four examples and three chips (Call people, WhatsApp, Quote)", () => {
    expect(PLACEHOLDER_KEYS).toHaveLength(4);
    expect(CHIPS.map((c) => c.id)).toEqual(["call", "whatsapp", "quote"]);
  });
});
