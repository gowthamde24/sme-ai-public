import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const M = "33333333-3333-4333-8333-333333333333";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, search: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/retailers", async (orig) => ({ ...(await orig<typeof import("@/lib/api/retailers")>()), searchRetailers: (...a: unknown[]) => h.search(...a) }));

import { POST } from "./route";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const GOOD = { kind: "saree wholesalers", city: "Guntur", messageId: M };
function post(body: unknown, headers: Record<string, string> = SAME) {
  return POST(new NextRequest(`https://${HOST}/app/tenants/${T}/retailers/search`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }), { params: Promise.resolve({ tenantId: T }) });
}
beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.search.mockReset().mockResolvedValue({ cards: [{ id: "3b1c0000-0000-4000-8000-000000000001", label: "Balaji", url: null }], text: "ok", error: null });
});

describe("POST retailers/search", () => {
  it("makes the question itself (the browser cannot ask your assistant anything else through this door) and answers {ok, data}", async () => {
    const r = await post(GOOD);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, data: { cards: [{ label: "Balaji" }], error: null } });
    expect(h.search).toHaveBeenCalledWith("person-token", T, { messageId: M, text: "Find retailers: saree wholesalers in Guntur" });
  });
  it.each([
    ["a phone number in the question", { ...GOOD, kind: "shops 9876543210" }],
    ["an empty kind", { ...GOOD, kind: "" }],
    ["a link", { ...GOOD, city: "https://x.test" }],
  ])("refuses %s with 422 before asking", async (_n, body) => {
    const r = await post(body);
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.search).not.toHaveBeenCalled();
  });
  it.each([["a message id that is not a uuid", { ...GOOD, messageId: "x" }], ["a missing city", { kind: "x shops", messageId: M }], ["not JSON", "{{"]])("refuses %s with 400", async (_n, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.search).not.toHaveBeenCalled();
  });
  it("refuses another site (403) and an unsigned person (401)", async () => {
    expect((await post(GOOD, { host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
    h.user = null;
    expect((await post(GOOD)).status).toBe(401);
  });
  it.each([
    [new ApiRequestError(403, "forbidden", "x"), 403, "forbidden"],
    [new ApiRequestError(409, "agents_disabled", "x"), 409, "conflict"],
    [new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 12), 429, "rate_limited"],
    [new ApiRequestError(503, "assistant_unavailable", "x"), 503, "unavailable"],
  ])("a refusal (%j) is our shape with status %i", async (error, status, kind) => {
    h.search.mockRejectedValue(error);
    const r = await post(GOOD);
    expect(r.status).toBe(status);
    expect(await r.json()).toMatchObject({ ok: false, kind });
  });
});
