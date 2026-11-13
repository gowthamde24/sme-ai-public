import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const KID = "22222222-2222-4222-8222-222222222222";
const KEY = { id: KID, name: "n", mode: "test" as const, prefix: "sk_test_ab12", last4: "wxyz", scopes: ["leads:write" as const], createdAt: "2026-11-12T05:00:00Z", lastUsedAt: null, revokedAt: null, ipAllow: [] };
const SECRET = "sk_test_fake_aaaa_bbbb_cccc";
const h = vi.hoisted(() => ({ make: vi.fn(), rotate: vi.fn(), stop: vi.fn(), role: { v: "owner" }, mode: { v: "on" } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => ({ id: T, name: "x", role: h.role.v }) }));
vi.mock("@/lib/developer/source", () => ({ makeKey: (...a: unknown[]) => h.make(...a), newSecret: (...a: unknown[]) => h.rotate(...a), stopKey: (...a: unknown[]) => h.stop(...a) }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), developerKeysScreens: () => h.mode.v }));

import { createKeyAction, revokeKeyAction, rotateKeyAction } from "./developer-actions";

beforeEach(() => {
  h.make.mockReset().mockResolvedValue({ key: KEY, secret: SECRET });
  h.rotate.mockReset().mockResolvedValue({ key: KEY, secret: SECRET });
  h.stop.mockReset().mockResolvedValue({ ...KEY, revokedAt: "2026-11-13T07:00:00Z" });
  h.role.v = "owner";
  h.mode.v = "on";
});

describe("developer key actions (test mode)", () => {
  it("makes a key with a clean name, known scopes and trimmed addresses, and returns the secret in the result only", async () => {
    const r = await createKeyAction(T, { name: "  Website form ", scopes: ["leads:write", "leads:write", "bogus", "usage:read"], ipAllow: [" 203.0.113.4 ", ""] });
    expect(r).toEqual({ ok: true, data: { key: KEY, secret: SECRET } });
    expect(h.make).toHaveBeenCalledWith("tok", T, { name: "Website form", scopes: ["leads:write", "usage:read"], ipAllow: ["203.0.113.4"] });
  });
  it("refuses before asking: no name, a long name, no scope, too many addresses", async () => {
    for (const bad of [{ name: " ", scopes: ["leads:write"], ipAllow: [] }, { name: "x".repeat(61), scopes: ["leads:write"], ipAllow: [] }, { name: "n", scopes: ["bogus"], ipAllow: [] }, { name: "n", scopes: ["leads:write"], ipAllow: Array.from({ length: 11 }, () => "1.1.1.1") }]) {
      expect(await createKeyAction(T, bad)).toMatchObject({ ok: false, kind: "invalid", code: "validation_error" });
    }
    expect(h.make).not.toHaveBeenCalled();
  });
  it("a member who is not an Owner or Admin, a flag that is off and a bad id are refused before the API", async () => {
    h.role.v = "sales";
    expect(await createKeyAction(T, { name: "n", scopes: ["leads:write"], ipAllow: [] })).toMatchObject({ ok: false, kind: "forbidden" });
    h.role.v = "admin";
    h.mode.v = "off";
    expect(await rotateKeyAction(T, KID)).toMatchObject({ ok: false, kind: "not_found" });
    h.mode.v = "on";
    expect(await revokeKeyAction(T, "x")).toMatchObject({ ok: false, kind: "not_found" });
    expect(h.make).not.toHaveBeenCalled();
    expect(h.rotate).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });
  it("rotate returns the new secret once; revoke returns the key with no secret", async () => {
    expect(await rotateKeyAction(T, KID)).toEqual({ ok: true, data: { key: KEY, secret: SECRET } });
    expect(await revokeKeyAction(T, KID)).toMatchObject({ ok: true, data: { secret: null, key: { revokedAt: "2026-11-13T07:00:00Z" } } });
  });
  it("says a refusal with the API's closed code and no secret, and the second step as its own kind", async () => {
    h.make.mockRejectedValueOnce(new ApiRequestError(409, "too_many_keys", "x"));
    expect(await createKeyAction(T, { name: "n", scopes: ["leads:write"], ipAllow: [] })).toMatchObject({ ok: false, kind: "conflict", code: "too_many_keys" });
    h.make.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await createKeyAction(T, { name: "n", scopes: ["leads:write"], ipAllow: [] })).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.make.mockRejectedValueOnce(new ApiRequestError(422, "live_not_available", "x"));
    expect(JSON.stringify(await createKeyAction(T, { name: "n", scopes: ["leads:write"], ipAllow: [] }))).not.toContain("sk_");
  });
});
