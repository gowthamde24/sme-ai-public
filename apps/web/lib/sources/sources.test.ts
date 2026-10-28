import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { getCards, indiaMartKey, metaConnect, metaSelect, sourceErrorOf } from "@/lib/api/source-cards";

import { liveApi } from "./server";
import { parseAuthorize, parseCards, parseEmail } from "./types";

const T = "55555555-5555-4555-8555-555555555555";
beforeEach(() => {
  request.mockReset();
});

describe("the cards as the API sends them", () => {
  it("keeps the order, drops a kind this app does not know and a status it does not know, reads problems and unavailable cards", () => {
    const cards = parseCards({ items: [{ kind: "meta", status: "connected", headline: "Connected", detail: "12 leads this week", received_7d: 12, last_received_at: "t", action: { type: "oauth", label: "x" }, problem: null, available: true }, { kind: "tiktok", status: "connected" }, { kind: "website", status: "weird" }, { kind: "indiamart", status: "needs_attention", headline: "Needs attention", action: { type: "paste_key" }, problem: { code: "indiamart_key_rejected", message: "IndiaMART key stopped working: paste a new one", fix: { type: "paste_key", label: "x" } }, available: true }, { kind: "missed_calls", status: "coming_soon", action: { type: "none" }, available: false }] });
    expect(cards?.map((c) => c.kind)).toEqual(["meta", "indiamart", "missed_calls"]);
    expect(cards?.[0]).toMatchObject({ received7d: 12, detail: "12 leads this week", action: "oauth" });
    expect(cards?.[1].problem).toEqual({ message: "IndiaMART key stopped working: paste a new one", fix: "paste_key" });
    expect(cards?.[2].available).toBe(false);
    expect(parseCards({})).toBeNull();
  });
  it("opens only a secure Facebook address", () => {
    expect(parseAuthorize({ authorize_url: "https://www.facebook.com/dialog/oauth?x=1" })).toContain("facebook.com");
    for (const bad of ["http://x.test", "javascript:alert(1)", "not a url", 5]) expect(parseAuthorize({ authorize_url: bad })).toBeNull();
  });
  it("reads the forwarding address with its Gmail guide", () => {
    expect(parseEmail({ address: "abc@leads.stack19.com", gmail_filter_guide: [{ step: 1, text: "Open Gmail" }, { step: 2 }], sample_portals: ["JustDial"] })).toEqual({ address: "abc@leads.stack19.com", guide: [{ step: 1, text: "Open Gmail" }], portals: ["JustDial"] });
  });
});

describe("the API calls", () => {
  it("go to the workspace's own cards; a bad answer is a contract error; the key goes in the body and only its hint comes back", async () => {
    request.mockResolvedValue({ items: [] });
    expect(await getCards("tok", T)).toEqual([]);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/cards`, "tok");
    request.mockResolvedValue({ nope: 1 });
    await expect(getCards("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    request.mockResolvedValue({ status: "connected", key_hint: "...a1b2" });
    expect(await indiaMartKey("tok", T, "ABCD-CRM-VALUE")).toEqual({ status: "connected", hint: "...a1b2" });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/indiamart/key`, "tok", { method: "PUT", body: JSON.stringify({ crm_key: "ABCD-CRM-VALUE" }) });
    request.mockResolvedValue({ authorize_url: "http://insecure.test" });
    await expect(metaConnect("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(metaSelect("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
  });
  it("turn refusals into closed words and let a lapsed sign-in through", async () => {
    const e = (status: number, code: string) => sourceErrorOf(new ApiRequestError(status, code, "English"));
    expect(e(422, "indiamart_key_rejected")).toBe("badkey");
    expect(e(409, "x")).toBe("state");
    expect(e(429, "x")).toBe("slow");
    expect(e(403, "x")).toBe("forbidden");
    expect(e(503, "source_unavailable")).toBe("notavailable");
    expect(sourceErrorOf(new Error("x"))).toBe("down");
    request.mockRejectedValue(new ApiRequestError(422, "key_rejected", "x"));
    expect(await liveApi("tok", T).indiaMartKey("k")).toEqual({ ok: false, error: "badkey" });
    const out = new ApiAuthError("out");
    request.mockImplementation(() => Promise.reject(out));
    let caught: unknown = null;
    try {
      await liveApi("tok", T).cards();
    } catch (x) {
      caught = x;
    }
    expect(caught).toBe(out);
  });
});
