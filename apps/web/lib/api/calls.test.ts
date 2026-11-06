import { afterEach, describe, expect, it, vi } from "vitest";

import { getCallBrief, markCallHandled } from "./calls";

const T = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const L = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("the calls a Needs-you card makes (C1's /calls)", () => {
  it("reads the lead and the short summary of a call, nothing else", async () => {
    stub({ id: C, lead_id: L, summary_short: "Wants to talk about a bulk order.", transcript: [{ who: "caller", text: "x" }] });
    expect(await getCallBrief("tok", T, C)).toEqual({ leadId: L, gist: "Wants to talk about a bulk order.", visitAt: null });
    stub({ id: C, lead_id: null, summary_short: null, captured: { visit_at: "2026-11-03T10:00:00+05:30" } });
    expect(await getCallBrief("tok", T, C)).toEqual({ leadId: null, gist: null, visitAt: "2026-11-03T10:00:00+05:30" });
    stub({ id: C, lead_id: null, summary_short: null, captured: { visit_at: "Tuesday" } });
    expect((await getCallBrief("tok", T, C)).visitAt).toBeNull();
  });
  it("refuses another call's body, and an id that is not one is never asked for", async () => {
    stub({ id: L });
    await expect(getCallBrief("tok", T, C)).rejects.toThrow();
    await expect(getCallBrief("tok", T, "../x")).rejects.toThrow();
  });
  it("marks a call handled with a POST to its own address", async () => {
    const f = stub({ call_id: C, handled_at: "2026-11-05T10:00:00Z" });
    await markCallHandled("tok", T, C);
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(String(url)).toMatch(new RegExp(`/v1/tenants/${T}/calls/${C}/handled$`));
    expect(init.method).toBe("POST");
  });
});
