import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const ID = "55555555-5555-4555-8555-555555555555";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, search: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/search", () => ({ searchRecords: (...a: unknown[]) => h.search(...a) }));

import { GET } from "./route";

const HOST = "app.example.test";
const get = (q: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin", host: HOST }, tenant = T) =>
  GET(new NextRequest(`https://${HOST}/app/tenants/${tenant}/search?q=${encodeURIComponent(q)}`, { headers }), { params: Promise.resolve({ tenantId: tenant }) });

beforeEach(() => {
  h.user = { accessToken: "tok" };
  h.search.mockReset();
});

describe("GET /app/tenants/[tenantId]/search (the palette's records)", () => {
  it("asks C1's search with the person's own token and answers {items}, never cached", async () => {
    h.search.mockResolvedValue([{ kind: "lead", id: ID, title: "Anjali", sub: null }]);
    const r = await get("anjali");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ items: [{ kind: "lead", id: ID, title: "Anjali", sub: null }] });
    expect(h.search).toHaveBeenCalledWith("tok", T, "anjali");
  });
  it("refuses another site, a bad workspace id and no session; any other failure is no items", async () => {
    expect((await get("anjali", { "sec-fetch-site": "cross-site", origin: "https://evil.example", host: HOST })).status).toBe(403);
    expect((await get("anjali", undefined, "nope")).status).toBe(404);
    h.user = null;
    expect((await get("anjali")).status).toBe(401);
    h.user = { accessToken: "tok" };
    h.search.mockRejectedValue(new ApiAuthError("expired"));
    expect((await get("anjali")).status).toBe(401);
    h.search.mockRejectedValue(new Error("down"));
    const r = await get("anjali");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ items: [] });
  });
});
