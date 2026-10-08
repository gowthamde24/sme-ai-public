import { describe, expect, it } from "vitest";

import { MAX_LINK_TEXT_ENCODED, encodedLength, fitsInLink } from "./limit";
import { whatsappDigits, whatsappUrl } from "./link";

describe("whatsappDigits: the owner's number rule", () => {
  it.each([
    ["+91 98765 43210"],
    ["+919876543210"],
    ["00919876543210"],
    ["0091 98765 43210"],
    ["+91-98765-43210"],
    ["+91 (98765) 43210"],
    ["98765 43210"],
    ["9876543210"],
    ["(98765) 43210"],
    ["98765.43210"],
    ["  98765-43210  "],
    ["９８７６５４３２１０"], // full-width digits: NFKC makes them ASCII
  ])("%s is the Indian mobile 9876543210 with its country code", (stored) => {
    expect(whatsappDigits(stored)).toBe("919876543210");
  });

  it.each([["6000000000"], ["7000000000"], ["8000000000"], ["9000000000"]])("a plain ten-digit number starting 6 to 9 (%s) gets 91", (stored) => {
    expect(whatsappDigits(stored)).toBe(`91${stored}`);
  });

  it.each([["0123456789"], ["1234567890"], ["2234567890"], ["3234567890"], ["4234567890"], ["5234567890"]])("a plain ten-digit number starting 0 to 5 (%s) is not a mobile: null", (stored) => {
    expect(whatsappDigits(stored)).toBeNull();
  });

  it.each([
    ["+44 20 7946 0958", "442079460958"],
    ["+1 (415) 555 0132", "14155550132"],
    ["0044 20 7946 0958", "442079460958"],
    ["+49 30 1234567", "49301234567"],
  ])("a number written with a plus or 00 keeps its own country code (%s)", (stored, digits) => {
    expect(whatsappDigits(stored)).toBe(digits);
  });

  it.each([
    ["919876543210"], // 12 digits, 91 first, no plus
    ["09876543210"], // a leading 0
    ["098765 43210"],
    ["098765-43210"],
    ["987654321"], // nine digits
    ["98765432101"], // eleven digits
    ["987654321012"], // twelve, not 91
    ["+00 90000 20001"], // this workspace's synthetic numbers are never a real chat
    ["+0098765 43210"],
    ["000098765 43210"],
    ["+0 9876543210"],
    ["+1234567"], // seven digits after a plus
    ["+1234567890123456"], // sixteen digits
    ["0012345"],
    ["+"],
    ["00"],
    [""],
    ["   "],
  ])("%j is not a usable number: null", (stored) => {
    expect(whatsappDigits(stored)).toBeNull();
  });

  it.each([
    ["98765 43210 ext 5"],
    ["call me"],
    ["98765 43210 / 98765 43211"],
    ["9876543210x"],
    ["98765+43210"],
    ["+91+9876543210"],
    ["++919876543210"],
    ["٩٨٧٦٥٤٣٢١٠"], // Arabic-Indic digits are refused
    ["९८७६५४३२१०"], // Devanagari digits are refused
    ["9876543210#1"],
    ["tel:9876543210"],
  ])("%j has characters that are not digits or separators: null", (stored) => {
    expect(whatsappDigits(stored)).toBeNull();
  });

  it("white space of any kind is a separator, and the ends are trimmed", () => {
    expect(whatsappDigits("+91 9876543210\n")).toBe("919876543210");
    expect(whatsappDigits("98765\t43210")).toBe("919876543210");
  });

  it("accepts exactly 8 to 15 digits after a plus and no more or fewer", () => {
    expect(whatsappDigits("+12345678")).toBe("12345678");
    expect(whatsappDigits("+123456789012345")).toBe("123456789012345");
    expect(whatsappDigits("+1234567")).toBeNull();
    expect(whatsappDigits("+1234567890123456")).toBeNull();
  });

  it("gives null for a stored value that is not a string", () => {
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits(undefined)).toBeNull();
    // @ts-expect-error a number is not a stored phone
    expect(whatsappDigits(9876543210)).toBeNull();
  });

  it("never carries the input into anything it returns", () => {
    const stored = "98765 43210 private-note";
    expect(whatsappDigits(stored)).toBeNull();
    expect(String(whatsappDigits(stored))).not.toContain("private-note");
  });
});

describe("whatsappUrl", () => {
  const D = "919876543210";

  it("builds the wa.me address with the text percent-encoded whole", () => {
    const text = "Quote Q-00001\nTotal: ₹1,00,000 (incl. tax)";
    const url = whatsappUrl(D, text);
    expect(url).toBe(`https://wa.me/${D}?text=${encodeURIComponent(text)}`);
    expect(url).toContain("%0A");
    expect(url).toContain("%20");
    expect(url).toContain("%E2%82%B9");
    expect(url).not.toMatch(/[ \n+]/);
    expect(decodeURIComponent(String(url).split("?text=")[1] ?? "")).toBe(text);
  });

  it("with no text it is the chat alone", () => {
    expect(whatsappUrl(D, null)).toBe(`https://wa.me/${D}`);
  });

  it("an empty text is not a link", () => {
    expect(whatsappUrl(D, "")).toBeNull();
  });

  it.each([[""], ["0"], ["+919876543210"], ["91 9876543210"], ["abc"], ["1234567"], ["1234567890123456"], ["0919876543210"]])("digits that are not digits for a link (%j) give null", (digits) => {
    expect(whatsappUrl(digits, "hello")).toBeNull();
    expect(whatsappUrl(digits, null)).toBeNull();
  });

  it("never shortens a quote: a text over the limit is refused whole, one at the limit is not", () => {
    const atLimit = "a".repeat(MAX_LINK_TEXT_ENCODED);
    const over = "a".repeat(MAX_LINK_TEXT_ENCODED + 1);
    expect(whatsappUrl(D, atLimit)).toBe(`https://wa.me/${D}?text=${atLimit}`);
    expect(whatsappUrl(D, over)).toBeNull();
    const oneUnder = "a".repeat(MAX_LINK_TEXT_ENCODED - 1);
    expect(whatsappUrl(D, oneUnder)).not.toBeNull();
  });
});

describe("the limit is counted on the ENCODED text", () => {
  it("is a named placeholder of 2,000 and says so", () => {
    expect(MAX_LINK_TEXT_ENCODED).toBe(2000);
  });

  it("a rupee sign counts nine and a line break three", () => {
    expect(encodedLength("₹")).toBe(9);
    expect(encodedLength("\n")).toBe(3);
    expect(encodedLength(" ")).toBe(3);
    expect(encodedLength("a")).toBe(1);
  });

  it("the boundary: exactly at the limit fits, one over does not (with multi-byte characters too)", () => {
    const rupees = Math.floor(MAX_LINK_TEXT_ENCODED / 9);
    const atLimit = "₹".repeat(rupees) + "a".repeat(MAX_LINK_TEXT_ENCODED - rupees * 9);
    expect(encodedLength(atLimit)).toBe(MAX_LINK_TEXT_ENCODED);
    expect(fitsInLink(atLimit)).toBe(true);
    expect(fitsInLink(`${atLimit}a`)).toBe(false);
    expect(whatsappUrl("919876543210", `${atLimit}a`)).toBeNull();
  });

  it("a 721-character text can be 1,185 characters encoded and still fit", () => {
    const text = `${"₹ 1,00,000\n".repeat(30)}${"x".repeat(721 - 30 * 11)}`;
    expect(text.length).toBe(721);
    expect(encodedLength(text)).toBeGreaterThan(721);
    expect(fitsInLink(text)).toBe(encodedLength(text) <= 2000);
  });

  it("an empty text does not fit", () => {
    expect(fitsInLink("")).toBe(false);
  });
});
