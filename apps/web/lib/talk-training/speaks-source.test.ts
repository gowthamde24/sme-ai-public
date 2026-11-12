import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ v: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.v.has(k) ? { value: jar.v.get(k) } : undefined), set: (k: string, v: string) => void jar.v.set(k, v) }) }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api/how-speaks", () => ({ getHowSpeaks: api.get, putHowSpeaks: api.put }));

import { MOCK_COOKIE, readSpeaks, saveSpeaks, type Facts } from "./speaks-source";

const CTX = { token: "tok", tenantId: "11111111-1111-4111-8111-111111111111" };
const F: Facts = { legacyAddress: null, packDefault: "friendly", ownerName: "Gowtham" };

beforeEach(() => {
  jar.v.clear();
  vi.stubEnv("SPEAKS_PANEL_SCREENS", "mock");
  api.get.mockReset();
  api.put.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("How your assistant speaks, test mode (SPEAKS_PANEL_SCREENS=mock): made up from the contract, in a cookie, no API", () => {
  it("starts from the business type's usual tone and says so; an old garu/ji/sir_madam is migrated to Respectful and says so; plain is not a choice", async () => {
    const r = await readSpeaks(CTX, F);
    expect(r).toMatchObject({ mode: "ok", demo: true, data: { tone: { value: "friendly", source: "pack_default" }, introduceAs: { kind: "business", ownerName: "Gowtham" }, legacyAddress: null } });
    expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true);
    const m = await readSpeaks(CTX, { ...F, legacyAddress: "garu" });
    expect(m.mode === "ok" && m.data.tone).toMatchObject({ value: "respectful", source: "migrated" });
    const p = await readSpeaks(CTX, { ...F, legacyAddress: "plain", packDefault: "respectful" });
    expect(p.mode === "ok" && p.data.tone).toMatchObject({ value: "respectful", source: "pack_default" }); // a school that never touched it
  });
  it("a save changes only what was sent; the first save writes the tone (saved), the old setting stays as it was; null resets", async () => {
    const out = await saveSpeaks(CTX, { tone: "respectful", words: { te: { style: "everyday_pure", region: "telangana" } } }, { ...F, legacyAddress: "ji" });
    expect(out.tone).toMatchObject({ value: "respectful", source: "saved" });
    expect(out.words.te).toMatchObject({ style: "everyday_pure", region: "telangana", saved: true });
    expect(out.words.kn).toMatchObject({ style: "everyday_mixed", region: "neutral", saved: false });
    expect(out.legacyAddress).toBe("ji"); // nothing is lost
    expect(jar.v.get(MOCK_COOKIE)?.length).toBeLessThan(3000);
    const later = await saveSpeaks(CTX, { words: { te: { region: "coastal" } } }, F);
    expect(later.words.te).toMatchObject({ style: "everyday_pure", region: "coastal" }); // the style kept, only the region changed
    const reset = await saveSpeaks(CTX, { tone: null }, { ...F, legacyAddress: "ji" });
    expect(reset.tone).toMatchObject({ value: "respectful", source: "migrated" }); // back to what the old setting maps to
  });
  it("Introduce as is kept with its owner's name; \"My name\" with no first name is refused as the API would; what the API refuses is refused here, with the same codes", async () => {
    const out = await saveSpeaks(CTX, { introduceAs: { kind: "owner", text: "Gowtham" } }, F);
    expect(out.introduceAs).toMatchObject({ kind: "owner", text: "Gowtham", ownerName: "Gowtham" });
    await expect(saveSpeaks(CTX, { introduceAs: { kind: "owner", text: "Gowtham" } }, { ...F, ownerName: null })).rejects.toMatchObject({ status: 422, code: "validation_error" });
    await expect(saveSpeaks(CTX, { tone: "casual" } as never, F)).rejects.toMatchObject({ status: 422, code: "validation_error" });
    await expect(saveSpeaks(CTX, { introduceAs: { kind: "custom", text: "a human AI assistant" } }, F)).rejects.toMatchObject({ status: 422 });
    await expect(saveSpeaks(CTX, {}, F)).rejects.toMatchObject({ status: 422 });
  });
  it("a cookie that is not ours is ignored", async () => {
    jar.v.set(MOCK_COOKIE, "{not json");
    expect((await readSpeaks(CTX, F)).mode).toBe("ok");
    jar.v.set(MOCK_COOKIE, JSON.stringify([1, 2]));
    expect((await readSpeaks(CTX, F)).mode).toBe("ok");
  });
});

describe("the other modes", () => {
  it("off: the panel is not there and nothing can be changed", async () => {
    vi.stubEnv("SPEAKS_PANEL_SCREENS", "");
    expect(await readSpeaks(CTX, F)).toEqual({ mode: "off" });
    await expect(saveSpeaks(CTX, { tone: "friendly" }, F)).rejects.toMatchObject({ status: 404 });
  });
  it("on: C1's endpoint (the contract's, built after it); a failure is 'unavailable', never made-up data", async () => {
    vi.stubEnv("SPEAKS_PANEL_SCREENS", "1");
    api.get.mockResolvedValueOnce({ tone: { value: "friendly" } });
    expect(await readSpeaks(CTX, F)).toMatchObject({ mode: "ok", demo: false });
    expect(api.get).toHaveBeenCalledWith("tok", CTX.tenantId);
    api.get.mockRejectedValueOnce(new Error("down"));
    expect(await readSpeaks(CTX, F)).toEqual({ mode: "unavailable" });
    api.put.mockResolvedValueOnce({ ok: 1 });
    await saveSpeaks(CTX, { tone: "respectful" }, F);
    expect(api.put).toHaveBeenCalledWith("tok", CTX.tenantId, { tone: "respectful" });
  });
});
