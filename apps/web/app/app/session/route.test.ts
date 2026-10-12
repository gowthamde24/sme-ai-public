import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: h.getUser } }) }));

import { GET } from "./route";

const HOST = "app.example.test";
const get = (headers: Record<string, string> = { host: HOST, "sec-fetch-site": "same-origin" }) => GET(new NextRequest(`https://${HOST}/app/session`, { headers }));

beforeEach(() => h.getUser.mockReset());

describe("GET /app/session", () => {
  it("says signed in, and nothing else about the person", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "u", email: "secret@example.test" } }, error: null });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ signedIn: true });
    expect(text).not.toMatch(/secret|"id"/);
  });
  it("is a 401 when the Auth server rejects the session or there is no user", async () => {
    h.getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthApiError", status: 401, message: "expired" } });
    expect((await get()).status).toBe(401);
    h.getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400, message: "missing" } });
    expect((await get()).status).toBe(401);
    h.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await get()).status).toBe(401);
  });
  it("is a 503, not a 401, when the Auth server cannot be reached (an outage is not a sign-out)", async () => {
    for (const error of [{ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }, { name: "AuthApiError", status: 502, message: "bad gateway" }]) {
      h.getUser.mockResolvedValueOnce({ data: { user: null }, error });
      const r = await get();
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ signedIn: null });
    }
  });
  it("is a 503 too when asking throws", async () => {
    h.getUser.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await get()).status).toBe(503);
  });
  it("refuses a request from another site, without asking the Auth server", async () => {
    expect((await get({ host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(h.getUser).not.toHaveBeenCalled();
  });
});
