import { describe, expect, it } from "vitest";

import { WHATSAPP_CODES, GATE_CODES, whatsappCode } from "./codes";
import { indiaDate, quoteExpired } from "./expiry";

describe("indiaDate and quoteExpired", () => {
  it("the India date is five and a half hours ahead of UTC", () => {
    expect(indiaDate(new Date("2026-10-08T00:00:00Z"))).toBe("2026-10-08");
    expect(indiaDate(new Date("2026-10-07T18:29:59Z"))).toBe("2026-10-07");
    expect(indiaDate(new Date("2026-10-07T18:30:00Z"))).toBe("2026-10-08");
  });
  it("a quote is valid through its last day and expired the day after (India)", () => {
    expect(quoteExpired("2026-10-08", new Date("2026-10-08T18:29:59Z"))).toBe(false);
    expect(quoteExpired("2026-10-08", new Date("2026-10-08T18:30:00Z"))).toBe(true);
    expect(quoteExpired("2026-10-09", new Date("2026-10-08T18:30:00Z"))).toBe(false);
  });
  it.each([[""], ["soon"], ["2026-10-8"], ["08-10-2026"], ["2026-10-08T00:00:00Z"]])("a value that is not a calendar date (%j) counts as expired", (value) => {
    expect(quoteExpired(value, new Date("2026-10-08T00:00:00Z"))).toBe(true);
  });
});

describe("the closed codes", () => {
  it("are the twelve words, each a plain lower-case token", () => {
    expect(WHATSAPP_CODES).toHaveLength(12);
    for (const code of WHATSAPP_CODES) expect(code).toMatch(/^[a-z_]+$/);
    expect(WHATSAPP_CODES).toContain("not_from_here");
  });
  it("the gate words are a subset", () => {
    for (const word of GATE_CODES) expect((WHATSAPP_CODES as readonly string[]).includes(word)).toBe(true);
  });
  it("whatsappCode accepts a code and nothing else", () => {
    expect(whatsappCode("expired")).toBe("expired");
    expect(whatsappCode(["too_long", "x"])).toBe("too_long");
    for (const bad of [undefined, null, "", "EXPIRED", "expired ", "<script>", "x".repeat(40), "919876543210", []]) expect(whatsappCode(bad as string)).toBeNull();
  });
});
