import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void jar.delete(k) : void jar.set(k, v)) }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { parseConnect } from "@/lib/sources/types";
import { getCards, indiaMartKey, metaConnect, metaSelect, resumeCard, sourceErrorOf } from "@/lib/api/source-cards";

import { liveApi } from "./server";
import { parseAuthorize, parseCards, parseEmail, parseTest } from "./types";

const T = "55555555-5555-4555-8555-555555555555";
beforeEach(() => {
  jar.clear();
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
    expect(parseEmail({ address: "abc@leads.stack19.com", gmail_filter_guide: [{ step: 1, text: "Open Gmail" }, { step: 2 }], sample_portals: ["JustDial"] })).toEqual({ address: "abc@leads.stack19.com", guide: [{ step: 1, text: "Open Gmail" }], portals: ["JustDial"], confirmation: null });
  });
  it("reads the code Gmail sent to confirm forwarding, and the actions the API adds", () => {
    expect(parseEmail({ address: "a@leads.stack19.com", gmail_filter_guide: [], sample_portals: [], gmail_confirmation: { code: "123456789", received_at: "2026-10-29T10:00:00Z" } })?.confirmation).toEqual({ code: "123456789", receivedAt: "2026-10-29T10:00:00Z" });
    const paused = parseCards({ items: [{ kind: "website", status: "needs_attention", headline: "Paused", action: { type: "copy_snippet" }, problem: { code: "source_paused", message: "This is paused, so no new leads come in.", fix: { type: "resume", label: "Turn back on" } }, available: true }] });
    expect(paused?.[0].problem).toEqual({ message: "This is paused, so no new leads come in.", fix: "resume" });
  });
});

describe("the API calls", () => {
  it("go to the workspace's own cards; a bad answer is a contract error; the key goes in the body and only its hint comes back", async () => {
    request.mockResolvedValue({ items: [] });
    expect(await getCards("tok", T)).toEqual([]);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/lead-sources/cards`, "tok");
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/outreach/source-costs`, "tok"); // the owner's cost per lead is read next to the cards
    request.mockResolvedValue({ nope: 1 });
    await expect(getCards("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    // each card gets the cost entered under ITS lead tag; a failed cost read leaves the cards alone
    request.mockImplementation(async (path: string) => (path.endsWith("/source-costs") ? { costs: [{ source: "website_form", cost_per_lead_paise: 4500 }] } : { items: [{ kind: "website", status: "connected", state: "connected", cost_source: "website_form" }, { kind: "meta", status: "not_connected", state: "off" }] }));
    expect((await getCards("tok", T)).map((c) => [c.kind, c.costPerLeadPaise])).toEqual([["website", 4500], ["meta", null]]);
    request.mockImplementation(async (path: string) => { if (path.endsWith("/source-costs")) throw new Error("down"); return { items: [{ kind: "website", status: "connected", state: "connected" }] }; });
    expect((await getCards("tok", T))[0].costPerLeadPaise).toBeNull();
    // the owner's own key: the door answers the card (no hint: the key is never read back); one door only, no older fallback
    request.mockReset();
    request.mockResolvedValue({ kind: "indiamart", state: "waiting" });
    expect(await indiaMartKey("tok", T, "ABCD-CRM-VALUE")).toEqual({ status: "connected", hint: "" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/cards/indiamart/connect`, "tok", { method: "POST", body: JSON.stringify({ key: "ABCD-CRM-VALUE" }) });
    request.mockResolvedValue({ kind: "indiamart", state: "needs_attention" });
    expect(await indiaMartKey("tok", T, "ABCD-CRM-VALUE")).toEqual({ status: "needs_attention", hint: "" });
    request.mockResolvedValue({ kind: "indiamart", state: "off" }); // a card that is not connected after an accepted key is not understood
    await expect(indiaMartKey("tok", T, "ABCD-CRM-VALUE")).rejects.toBeInstanceOf(ApiContractError);
    for (const [status, code] of [[409, "not_available"], [404, "not_found"], [422, "key_rejected"]] as const) {
      request.mockReset();
      request.mockRejectedValue(new ApiRequestError(status, code, "x")); // every refusal is shown, nothing is asked a second way
      await expect(indiaMartKey("tok", T, "ABCD-CRM-VALUE")).rejects.toBeInstanceOf(ApiRequestError);
      expect(request).toHaveBeenCalledTimes(1);
    }
    request.mockResolvedValue({ authorize_url: "http://insecure.test" });
    await expect(metaConnect("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(metaSelect("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
  });
  it("turn refusals into closed words and let a lapsed sign-in through", async () => {
    const e = (status: number, code: string) => sourceErrorOf(new ApiRequestError(status, code, "English"));
    expect(e(422, "indiamart_key_rejected")).toBe("badkey");
    expect(e(404, "not_found")).toBe("notavailable");
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

describe("turning a paused card back on", () => {
  it("resumes only the paused sources of that card", async () => {
    const src = (id: string, kind: string, status: string) => ({ id, kind, tag: kind === "email_forward" ? "justdial" : kind, label: kind, status, created_at: "2026-10-01T00:00:00Z", last_received_at: null, received_count: 0, token_hint: null, cost_per_lead_paise: null, consent_confirmed: true, available: true });
    request.mockImplementation(async (path: string) => (path.endsWith("/lead-sources") ? { items: [src("11111111-1111-4111-8111-111111111111", "website_form", "paused"), src("22222222-2222-4222-8222-222222222222", "webhook", "active"), src("33333333-3333-4333-8333-333333333333", "email_forward", "paused")] } : src("11111111-1111-4111-8111-111111111111", "website_form", "active")));
    await resumeCard("tok", T, "website");
    const posts = request.mock.calls.filter((c) => (c[2] as { method?: string } | undefined)?.method === "POST").map((c) => c[0]);
    expect(posts).toEqual([`/v1/tenants/${T}/lead-sources/11111111-1111-4111-8111-111111111111/resume`]);
    await expect(resumeCard("tok", T, "files")).rejects.toBeInstanceOf(ApiContractError);
  });

describe("the shown-once address", () => {
  it("is read from the connect answer: a copy field with a value and the steps; anything else is no address", () => {
    expect(parseConnect({ connect: { type: "copy", shown_once: true, fields: [{ label: "Address for Missed calls", value: "https://a/b", secret: true }], steps: ["one", "two"] } })).toEqual({ fields: [{ label: "Address for Missed calls", value: "https://a/b" }], steps: ["one", "two"] });
    expect(parseConnect({ connect: { type: "paste", fields: [{ label: "x", value: "y" }] } })).toBeNull();
    expect(parseConnect({ connect: { type: "copy", fields: [{ label: "x" }] } })).toBeNull();
    expect(parseConnect({ status: "ok" })).toBeNull();
  });
});
});

describe("the results of a test", () => {
  it("reads the IndiaMART check (no `ok`, no message) and the e-mail parser's portal; a refusal or an unknown result is no result", () => {
    expect(parseTest({ result: "key_valid", checked_at: "2026-11-15T10:00:00Z" })).toEqual({ result: "key_valid", message: "", leadId: null, portal: null });
    expect(parseTest({ result: "key_rejected" })?.result).toBe("key_rejected");
    expect(parseTest({ result: "rate_limited" })?.result).toBe("rate_limited");
    expect(parseTest({ ok: true, result: "lead_created", portal: "JustDial", lead: { lead_id: "L1" } })).toMatchObject({ result: "lead_created", portal: "JustDial", leadId: "L1" });
    expect(parseTest({ ok: false, result: "lead_created" })).toBeNull();
    expect(parseTest({ result: "something_new" })).toBeNull();
  });
});
