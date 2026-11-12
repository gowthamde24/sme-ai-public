import { afterEach, describe, expect, it, vi } from "vitest";

import { getHowSpeaks, putHowSpeaks } from "./how-speaks";

const T = "11111111-1111-4111-8111-111111111111";
const lang = { style: "everyday_mixed", region: "neutral", saved: false, examples: "approved" };
const BODY = { tone: { value: "friendly", source: "saved", pack_default: "friendly" }, words: { languages: { te: lang, kn: lang, hi: lang, ta: lang } }, introduce_as: { kind: "business", text: null, owner_name: null }, pack_defaults: { tone: "friendly" }, legacy_address: null, updated_at: null };
afterEach(() => vi.unstubAllGlobals());
const stub = (b: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("C1's /how-assistant-speaks (fixed contract, PR #459; the endpoint is built after it)", () => {
  it("GET reads the object; PUT sends only the contract's own words and reads the same object back; an answer that does not fit is an error", async () => {
    const f = stub(BODY);
    expect(await getHowSpeaks("tok", T)).toMatchObject({ tone: { value: "friendly" } });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toMatch(new RegExp(`/v1/tenants/${T}/how-assistant-speaks$`));
    await putHowSpeaks("tok", T, { tone: null, words: { te: { region: "coastal" } }, introduceAs: { kind: "owner", text: "Gowtham" } });
    const init = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(init[1].method).toBe("PUT");
    expect(JSON.parse(String(init[1].body))).toEqual({ tone: null, words: { te: { region: "coastal" } }, introduce_as: { kind: "owner", text: "Gowtham" } });
    await expect(putHowSpeaks("tok", T, {})).rejects.toThrow();
    stub({ nope: true });
    await expect(getHowSpeaks("tok", T)).rejects.toThrow();
    await expect(getHowSpeaks("tok", "../x")).rejects.toThrow();
  });
});
