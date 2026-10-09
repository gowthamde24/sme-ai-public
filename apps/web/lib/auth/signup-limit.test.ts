import { describe, expect, it } from "vitest";

import { clientIp, createSignupLimiter, DEFAULT_MAX_PER_HOUR, parseMaxPerHour } from "./signup-limit";

describe("parseMaxPerHour", () => {
  it("defaults to 5", () => {
    expect(DEFAULT_MAX_PER_HOUR).toBe(5);
    expect(parseMaxPerHour(undefined)).toBe(5);
  });
  it.each([["3", 3], [" 12 ", 12], ["1000", 1000], ["1", 1]])("reads %j as %i", (raw, want) => {
    expect(parseMaxPerHour(raw)).toBe(want);
  });
  it.each(["0", "-2", "1001", "abc", "", "5.5", "99999", "1e3"])("falls back to the default for %j", (raw) => {
    expect(parseMaxPerHour(raw)).toBe(5);
  });
});

describe("the per-address brake", () => {
  it("lets N through in an hour, refuses the next, and does not count a refusal", () => {
    let now = 1_000_000;
    const limiter = createSignupLimiter({ maxPerHour: 3, now: () => now });
    expect([1, 2, 3].map(() => limiter.allow("1.2.3.4"))).toEqual([true, true, true]);
    expect(limiter.allow("1.2.3.4")).toBe(false);
    expect(limiter.allow("1.2.3.4")).toBe(false);
    now += 59 * 60 * 1000;
    expect(limiter.allow("1.2.3.4")).toBe(false);
    now += 2 * 60 * 1000; // the first three are now older than an hour
    expect(limiter.allow("1.2.3.4")).toBe(true);
  });
  it("counts each address on its own", () => {
    const limiter = createSignupLimiter({ maxPerHour: 1, now: () => 5 });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
  });
  it("keeps its memory bounded when a flood of different addresses arrives", () => {
    let now = 0;
    const limiter = createSignupLimiter({ maxPerHour: 1, now: () => now });
    for (let i = 0; i < 12_000; i += 1) {
      now += 1;
      expect(limiter.allow(`10.0.${Math.floor(i / 250)}.${i % 250}`)).toBe(true);
    }
    // the oldest were dropped to make room; the newest are still remembered
    expect(limiter.allow(`10.0.${Math.floor(11_999 / 250)}.${11_999 % 250}`)).toBe(false);
  });
});

describe("clientIp", () => {
  const h = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null });
  it("takes the first x-forwarded-for entry, else x-real-ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("is 'unknown' for nothing or for something that is not an address", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "not an ip; drop table" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "x".repeat(300) }))).toBe("unknown");
  });
});
