import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { NO_COUNTS } from "@/lib/api/nav-counts";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, counts: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/nav-counts", async (orig) => ({ ...(await orig<typeof import("@/lib/api/nav-counts")>()), getNavCounts: (...a: unknown[]) => h.counts(...a) }));

import { GET } from "./route";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin" };
const get = (headers: Record<string, string> = SAME, tenant = T) => GET(new NextRequest(`https://${HOST}/app/tenants/${tenant}/nav-counts`, { headers }), { params: Promise.resolve({ tenantId: tenant }) });

beforeEach(() => {
  h.user = { accessToken: "tok" };
  h.counts.mockReset();
});

describe("GET /app/tenants/[id]/nav-counts (the menu's numbers)", () => {
  it("asks the API with the person's own token and answers {counts}, never cached", async () => {
    h.counts.mockResolvedValue({ ...NO_COUNTS, needsYou: 4 });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ counts: { ...NO_COUNTS, needsYou: 4 } });
    expect(h.counts).toHaveBeenCalledWith("tok", T);
  });
  it("another site, a bad workspace id or no session: refused before the API is asked", async () => {
    expect((await get({ host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get(SAME, "nope")).status).toBe(404);
    h.user = null;
    expect((await get()).status).toBe(401);
    expect(h.counts).not.toHaveBeenCalled();
  });
  it("a rejected session is a 401; any other failure is 'nothing known' (no badges), never an error page", async () => {
    h.counts.mockRejectedValueOnce(new ApiAuthError("x"));
    expect((await get()).status).toBe(401);
    h.counts.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    const r = await get();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ counts: NO_COUNTS });
  });
});
