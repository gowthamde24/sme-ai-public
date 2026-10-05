import { afterEach, describe, expect, it, vi } from "vitest";

import { padTo, parseConfirmType, parseTokenHash, parseTotpCode } from "./otp";

describe("parseConfirmType", () => {
  it.each(["invite", "recovery", "email"])("accepts %s", (t) => expect(parseConfirmType(t)).toBe(t));
  it.each(["signup", "magiclink", "email_change", "INVITE", "", " invite", undefined, null, 5, ["invite"]])(
    "refuses %j",
    (t) => expect(parseConfirmType(t)).toBeNull(),
  );
});

describe("parseTokenHash", () => {
  it("accepts a URL-safe token of sensible length", () => {
    expect(parseTokenHash("a".repeat(64))).toBe("a".repeat(64));
    expect(parseTokenHash("Ab-_1234")).toBe("Ab-_1234");
  });
  it.each(["", "short", "a".repeat(257), "has space 12345", "x/../y_12345", "tok;drop12345", "ünïcode1234", undefined, 5])(
    "refuses %j before it reaches the Auth server",
    (t) => expect(parseTokenHash(t)).toBeNull(),
  );
});

describe("parseTotpCode", () => {
  it("accepts six digits, with the spaces some apps show", () => {
    expect(parseTotpCode("123456")).toBe("123456");
    expect(parseTotpCode("123 456")).toBe("123456");
  });
  it.each(["12345", "1234567", "12345a", "", "١٢٣٤٥٦", undefined, 123456])("refuses %j", (c) =>
    expect(parseTotpCode(c)).toBeNull(),
  );
});

describe("padTo", () => {
  afterEach(() => vi.useRealTimers());
  it("holds a fast path until the minimum, and does not delay a slow one", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let done = false;
    const p = padTo(start, 800).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(799);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    const slowStart = Date.now() - 900;
    await padTo(slowStart, 800); // already past: returns at once
  });
});
