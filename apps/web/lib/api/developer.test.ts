import { describe, expect, it } from "vitest";

import { parseKey, parseKeys, parseNewKey, parseUsage } from "./developer";

const KEY = { id: "22222222-2222-4222-8222-222222222222", name: "Website form", mode: "test", prefix: "sk_test_ab12", last4: "wxyz", scopes: ["leads:write"], created_at: "2026-11-12T05:00:00Z", created_by: "u", last_used_at: null, rotated_at: null, revoked_at: null, ip_allow: [] };
const SECRET = "sk_test_fake_aaaa_bbbb_cccc";

describe("developer keys wire", () => {
  it("reads a key and a list, never a secret", () => {
    expect(parseKey(KEY)).toMatchObject({ name: "Website form", prefix: "sk_test_ab12", last4: "wxyz", scopes: ["leads:write"], lastUsedAt: null, revokedAt: null });
    expect(parseKeys({ items: [KEY, KEY] })).toHaveLength(2);
  });
  it("reads the rotated time and a revoked key from the real list, and a secret of 48 characters", () => {
    const [a, b] = parseKeys({ items: [{ ...KEY, rotated_at: "2026-11-13T05:00:00Z" }, { ...KEY, revoked_at: "2026-11-13T06:00:00Z" }] });
    expect(a).toMatchObject({ rotatedAt: "2026-11-13T05:00:00Z", revokedAt: null });
    expect(b.revokedAt).toBe("2026-11-13T06:00:00Z");
    const long = `sk_test_${"fake".repeat(10)}`; // fake: the real shape is sk_test_ and 40 characters
    expect(long).toHaveLength(48);
    expect(parseNewKey({ key: KEY, secret: long }).secret).toHaveLength(48);
  });
  it("refuses a live key, an unknown scope and a bad id", () => {
    expect(() => parseKey({ ...KEY, mode: "live" })).toThrow();
    expect(() => parseKey({ ...KEY, scopes: ["admin"] })).toThrow();
    expect(() => parseKey({ ...KEY, id: "x" })).toThrow();
  });
  it("a new key carries its secret once, and only a secret of the real shape", () => {
    expect(parseNewKey({ key: KEY, secret: SECRET }).secret).toBe(SECRET);
    expect(() => parseNewKey({ key: KEY, secret: "pk_live_x" })).toThrow();
    expect(() => parseNewKey({ key: KEY })).toThrow();
  });
  it("a failed parse never names the value", () => {
    try {
      parseNewKey({ key: KEY, secret: "sk_live_a_b_c" });
    } catch (e) {
      expect(String(e)).not.toContain("SECRETVALUE");
    }
  });
  it("reads the test usage", () => {
    expect(parseUsage({ mode: "test", today: { requests: 3, leads: 1, calls_simulated: 1 }, month: { requests: 40, leads: 9, calls_simulated: 8 }, limits: {} })).toEqual({ today: { requests: 3, leads: 1, callsSimulated: 1 }, month: { requests: 40, leads: 9, callsSimulated: 8 } });
    expect(() => parseUsage({ mode: "live", today: {}, month: {} })).toThrow();
  });
});
