// @vitest-environment node
import { describe, expect, it } from "vitest";

import { consented, oneLine, readSiteLang } from "./lead";
import { parseLeadLimit } from "./lead-limit";
import { chatAddress, ourWhatsappDigits } from "./whatsapp";

describe("what a visitor typed is checked, never trusted", () => {
  it("makes one clean line: control characters, line breaks and direction marks become spaces, spaces collapse, a length limit holds", () => {
    expect(oneLine("  Asha \n\t Rao\u0000  ", 80)).toBe("Asha Rao");
    expect(oneLine("a‮b c", 80)).toBe("a b c");
    expect(oneLine("x".repeat(100), 10)).toBe("x".repeat(10));
    expect(oneLine("   ", 80)).toBeNull();
    for (const bad of [undefined, null, 5, {}, ["a"]]) expect(oneLine(bad, 80)).toBeNull();
    expect([...oneLine("గ".repeat(30), 5)!]).toHaveLength(5); // counted in characters, not bytes
  });
  it("reads consent from a checkbox or a script and nothing else", () => {
    for (const yes of ["on", true, "true"]) expect(consented(yes)).toBe(true);
    for (const no of [undefined, false, "", "yes", 1, "off", null]) expect(consented(no)).toBe(false);
  });
  it("knows the four languages and falls back to English", () => {
    expect(readSiteLang("te")).toBe("te");
    for (const bad of ["fr", undefined, 3, "EN"]) expect(readSiteLang(bad)).toBe("en");
  });
  it("the hourly limit is a whole number from 1 to 500, else the default", () => {
    expect(parseLeadLimit(undefined)).toBe(10);
    expect(parseLeadLimit("25")).toBe(25);
    for (const bad of ["0", "501", "abc", "-1", "1.5", ""]) expect(parseLeadLimit(bad), bad).toBe(10);
  });
});

describe("our WhatsApp number and the chat address", () => {
  it("takes digits with a country code, ignoring spaces, plus and dashes; anything else is 'not set up'", () => {
    expect(ourWhatsappDigits("+91 98765-43210")).toBe("919876543210");
    expect(ourWhatsappDigits("919876543210")).toBe("919876543210");
    for (const bad of [undefined, "", "abc", "0123456789", "12345", "+91 98765 4321012345678"]) expect(ourWhatsappDigits(bad), String(bad)).toBeNull();
  });
  it("builds a wa.me address with the whole text percent-encoded, and refuses a text that is empty or too long", () => {
    expect(chatAddress("919876543210", "Hello & bye")).toBe("https://wa.me/919876543210?text=Hello%20%26%20bye");
    expect(chatAddress("919876543210", "")).toBeNull();
    expect(chatAddress("919876543210", "x".repeat(2000))).toBeNull();
    expect(chatAddress("12", "hi")).toBeNull();
  });
});
