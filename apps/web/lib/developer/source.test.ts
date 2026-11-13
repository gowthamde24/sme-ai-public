import { beforeEach, describe, expect, it, vi } from "vitest";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ jar: new Map<string, string>(), mode: { v: "mock" } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n) } : undefined), set: (n: string, v: string) => void h.jar.set(n, v) }) }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), developerKeysScreens: () => h.mode.v }));

import { COOKIE, makeKey, newSecret, readDeveloper, stopKey } from "./source";

beforeEach(() => {
  h.jar.clear();
  h.mode.v = "mock";
});
const input = { name: "Website form", scopes: ["leads:write" as const], ipAllow: [] };

describe("developer keys, test cookie source", () => {
  it("is off when the flag is off", async () => {
    h.mode.v = "off";
    expect(await readDeveloper("tok", T)).toEqual({ mode: "off" });
  });
  it("makes a key with a secret of the real shape and keeps only the prefix and last four in the cookie", async () => {
    const made = await makeKey("tok", T, input);
    expect(made.secret).toMatch(/^sk_test_[a-z0-9]{40}$/);
    expect(made.key.prefix).toBe(made.secret.slice(0, 12));
    expect(h.jar.get(COOKIE)).not.toContain(made.secret);
    const read = await readDeveloper("tok", T);
    expect(read).toMatchObject({ mode: "ok", mock: true, keys: [{ name: "Website form" }] });
  });
  it("rotates (new secret, new prefix) and revokes (kept, marked), and refuses an eleventh active key with the API's code", async () => {
    const a = await makeKey("tok", T, input);
    const r = await newSecret("tok", T, a.key.id);
    expect(r.secret).not.toBe(a.secret);
    const dead = await stopKey("tok", T, a.key.id);
    expect(dead.revokedAt).not.toBeNull();
    await expect(newSecret("tok", T, a.key.id)).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 10; i++) await makeKey("tok", T, { ...input, name: `k${i}` });
    await expect(makeKey("tok", T, input)).rejects.toMatchObject({ status: 409, code: "too_many_keys" });
  });
  it("a cookie that is not keys is ignored, never trusted", async () => {
    h.jar.set(COOKIE, JSON.stringify([{ id: "x" }]));
    expect(await readDeveloper("tok", T)).toMatchObject({ keys: [] });
  });
});
